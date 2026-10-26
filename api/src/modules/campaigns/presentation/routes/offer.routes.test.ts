import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { offerRoutes } from './offer.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { GenerateOfferUseCase } from '../../application/use-cases/GenerateOfferUseCase';
import { GetOfferUseCase } from '../../application/use-cases/GetOfferUseCase';
import { GetOfferUsageUseCase } from '../../application/use-cases/GetOfferUsageUseCase';
import { UpdateOfferUseCase } from '../../application/use-cases/UpdateOfferUseCase';
import { SendOfferUseCase } from '../../application/use-cases/SendOfferUseCase';
import { ListOfferDestinationsUseCase } from '../../application/use-cases/ListOfferDestinationsUseCase';
import { ReplaceOfferDestinationsUseCase } from '../../application/use-cases/ReplaceOfferDestinationsUseCase';
import { OfferNotFoundError } from '../../../../shared/errors/internal/OfferErrors';
import { toOfferDto, type OfferDTO } from '../../application/dtos/OfferDTO';
import { makeOffer } from '../../application/use-cases/offerTestFakes';

/*
 * Contrato HTTP (status, envelope, validação, ordem de rotas) com Fastify real, como
 * `chat.routes.test.ts`: sem banco, hooks falsos, use cases espionados no protótipo.
 */
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown }) => {
    request.user = { userId: 'user-a', isSuperAdmin: false };
  },
}));
vi.mock('../../../../shared/http/hooks/tenantHook', () => ({
  tenantHook: async (request: { tenantContext?: unknown }) => {
    request.tenantContext = { userId: 'user-a', tenantId: 'tenant-a', role: 'ADMIN', isSuperAdmin: false };
  },
}));

const PREFIX = '/api/campaigns/offers';
const UPLOAD_ID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';

function dto(): OfferDTO {
  return JSON.parse(JSON.stringify(toOfferDto(makeOffer())));
}

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(offerRoutes, { prefix: PREFIX });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('POST /', () => {
  it('201 com { offer, needsManualData } e contexto do tenant', async () => {
    const execute = vi.spyOn(GenerateOfferUseCase.prototype, 'execute')
      .mockResolvedValue({ offer: dto(), needsManualData: true });

    const res = await app.inject({ method: 'POST', url: `${PREFIX}/`, payload: { url: 'https://amzn.to/x' } });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ success: true, data: { offer: dto(), needsManualData: true } });
    expect(execute).toHaveBeenCalledWith({ tenantId: 'tenant-a', userId: 'user-a', url: 'https://amzn.to/x' });
  });

  it('400 sem url ou com url longa demais', async () => {
    const execute = vi.spyOn(GenerateOfferUseCase.prototype, 'execute');
    const semUrl = await app.inject({ method: 'POST', url: `${PREFIX}/`, payload: {} });
    const longa = await app.inject({ method: 'POST', url: `${PREFIX}/`, payload: { url: `https://x.com/${'a'.repeat(2048)}` } });
    expect(semUrl.statusCode).toBe(400);
    expect(longa.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('resposta não vaza campo fora do contrato', async () => {
    const offer = { ...dto(), secret: 'never' } as OfferDTO;
    vi.spyOn(GenerateOfferUseCase.prototype, 'execute').mockResolvedValue({ offer, needsManualData: false });
    const res = await app.inject({ method: 'POST', url: `${PREFIX}/`, payload: { url: 'https://amzn.to/x' } });
    expect(res.body).not.toContain('never');
  });
});

describe('rotas estáticas antes de /:id', () => {
  it('GET /usage', async () => {
    vi.spyOn(GetOfferUsageUseCase.prototype, 'execute').mockResolvedValue({ used: 3, limit: null });
    const getOffer = vi.spyOn(GetOfferUseCase.prototype, 'execute');
    const res = await app.inject({ method: 'GET', url: `${PREFIX}/usage` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { used: 3, limit: null } });
    expect(getOffer).not.toHaveBeenCalled();
  });

  it('GET /destinations', async () => {
    const list = [{ conversationId: 'c1', title: 'Grupo', isGroup: true, sessionId: 's1', sessionName: 'Loja' }];
    vi.spyOn(ListOfferDestinationsUseCase.prototype, 'execute').mockResolvedValue(list);
    const res = await app.inject({ method: 'GET', url: `${PREFIX}/destinations` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: list });
  });

  it('PUT /destinations valida maxItems 200', async () => {
    const replace = vi.spyOn(ReplaceOfferDestinationsUseCase.prototype, 'execute').mockResolvedValue([]);
    const ok = await app.inject({ method: 'PUT', url: `${PREFIX}/destinations`, payload: { conversationIds: ['c1'] } });
    const demais = await app.inject({
      method: 'PUT', url: `${PREFIX}/destinations`,
      payload: { conversationIds: Array.from({ length: 201 }, (_, i) => `c${i}`) },
    });
    expect(ok.statusCode).toBe(200);
    expect(demais.statusCode).toBe(400);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith({ tenantId: 'tenant-a', conversationIds: ['c1'] });
  });
});

describe('/:id', () => {
  it('GET 200 e 404 traduzido', async () => {
    vi.spyOn(GetOfferUseCase.prototype, 'execute')
      .mockResolvedValueOnce(dto())
      .mockRejectedValueOnce(new OfferNotFoundError('x'));
    const ok = await app.inject({ method: 'GET', url: `${PREFIX}/offer-1` });
    const nf = await app.inject({ method: 'GET', url: `${PREFIX}/x` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.id).toBe('offer-1');
    expect(nf.statusCode).toBe(404);
  });

  it('PATCH repassa campos; priceCents negativo e uploadId fora do formato → 400', async () => {
    const update = vi.spyOn(UpdateOfferUseCase.prototype, 'execute').mockResolvedValue(dto());
    const ok = await app.inject({
      method: 'PATCH', url: `${PREFIX}/offer-1`,
      payload: { priceCents: null, text: 'oi', imageUploadId: UPLOAD_ID },
    });
    const neg = await app.inject({ method: 'PATCH', url: `${PREFIX}/offer-1`, payload: { priceCents: -1 } });
    const up = await app.inject({ method: 'PATCH', url: `${PREFIX}/offer-1`, payload: { imageUploadId: '../x' } });
    expect(ok.statusCode).toBe(200);
    expect(neg.statusCode).toBe(400);
    expect(up.statusCode).toBe(400);
    expect(update).toHaveBeenCalledWith({
      tenantId: 'tenant-a', userId: 'user-a', offerId: 'offer-1',
      priceCents: null, text: 'oi', imageUploadId: UPLOAD_ID,
    });
  });

  it('POST /:id/send → 202 { offer, dispatches }', async () => {
    vi.spyOn(SendOfferUseCase.prototype, 'execute').mockResolvedValue({ offer: dto(), dispatches: [] });
    const res = await app.inject({ method: 'POST', url: `${PREFIX}/offer-1/send` });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ success: true, data: { offer: dto(), dispatches: [] } });
  });
});
