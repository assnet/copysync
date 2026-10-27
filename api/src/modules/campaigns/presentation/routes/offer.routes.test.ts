import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { offerRoutes } from './offer.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { GenerateOfferUseCase } from '../../application/use-cases/GenerateOfferUseCase';
import { GetOfferUseCase } from '../../application/use-cases/GetOfferUseCase';
import { GetOfferUsageUseCase } from '../../application/use-cases/GetOfferUsageUseCase';
import { UpdateOfferUseCase } from '../../application/use-cases/UpdateOfferUseCase';
import { SendOfferUseCase } from '../../application/use-cases/SendOfferUseCase';
import { RegenerateOfferTextUseCase } from '../../application/use-cases/RegenerateOfferTextUseCase';
import {
  GetOfferGeneratorConfigUseCase,
  SaveOfferGeneratorConfigUseCase,
  type OfferGeneratorConfigDTO,
} from '../../application/use-cases/OfferGeneratorConfigUseCases';
import { OfferLinkNotOwnedError, OfferNotFoundError } from '../../../../shared/errors/internal/OfferErrors';
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

const CONFIG: OfferGeneratorConfigDTO = {
  sessionId: 's1', intervalMinSeconds: 120, intervalMaxSeconds: 300,
  groups: [{ id: 'g1', title: 'Grupo', sessionId: 's1' }], groupLimit: null, configured: true,
};

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
  it('201 com { offer, needsManualData, aiFallback, aiErrorCode } e contexto do tenant', async () => {
    const data = { offer: dto(), needsManualData: true, aiFallback: true, aiErrorCode: 'AI_NOT_CONFIGURED' };
    const execute = vi.spyOn(GenerateOfferUseCase.prototype, 'execute').mockResolvedValue(data);

    const res = await app.inject({
      method: 'POST', url: `${PREFIX}/`, payload: { url: 'https://amzn.to/x', coupon: 'PROMO', audience: 'PET' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ success: true, data });
    expect(execute).toHaveBeenCalledWith({
      tenantId: 'tenant-a', userId: 'user-a', url: 'https://amzn.to/x', coupon: 'PROMO', audience: 'PET',
    });
  });

  it('400 com público desconhecido ou cupom > 40', async () => {
    const execute = vi.spyOn(GenerateOfferUseCase.prototype, 'execute');
    const aud = await app.inject({ method: 'POST', url: `${PREFIX}/`, payload: { url: 'https://amzn.to/x', audience: 'KIDS' } });
    const cup = await app.inject({ method: 'POST', url: `${PREFIX}/`, payload: { url: 'https://amzn.to/x', coupon: 'x'.repeat(41) } });
    expect(aud.statusCode).toBe(400);
    expect(cup.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('OFFER_LINK_NOT_OWNED → 422 com código', async () => {
    vi.spyOn(GenerateOfferUseCase.prototype, 'execute').mockRejectedValue(new OfferLinkNotOwnedError('AMAZON'));
    const res = await app.inject({ method: 'POST', url: `${PREFIX}/`, payload: { url: 'https://amzn.to/x' } });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('OFFER_LINK_NOT_OWNED');
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
    vi.spyOn(GenerateOfferUseCase.prototype, 'execute').mockResolvedValue({ offer, needsManualData: false, aiFallback: false });
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

  it('GET /config', async () => {
    const vi_ = vi.spyOn(GetOfferGeneratorConfigUseCase.prototype, 'execute').mockResolvedValue(CONFIG);
    const getOffer = vi.spyOn(GetOfferUseCase.prototype, 'execute');
    const res = await app.inject({ method: 'GET', url: `${PREFIX}/config` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: CONFIG });
    expect(vi_).toHaveBeenCalledWith('tenant-a');
    expect(getOffer).not.toHaveBeenCalled();
  });

  it('PUT /config repassa; intervalo fora de 60–3600 s, sem campo ou > 200 grupos → 400', async () => {
    const save = vi.spyOn(SaveOfferGeneratorConfigUseCase.prototype, 'execute').mockResolvedValue(CONFIG);
    const body = { sessionId: 's1', intervalMinSeconds: 120, intervalMaxSeconds: 300, conversationIds: ['g1'] };
    const ok = await app.inject({ method: 'PUT', url: `${PREFIX}/config`, payload: body });
    const bad = await Promise.all([
      { ...body, intervalMinSeconds: 59 },
      { ...body, intervalMaxSeconds: 3601 },
      { ...body, sessionId: undefined },
      { ...body, conversationIds: Array.from({ length: 201 }, (_, i) => `c${i}`) },
    ].map((payload) => app.inject({ method: 'PUT', url: `${PREFIX}/config`, payload })));
    expect(ok.statusCode).toBe(200);
    expect(bad.map((r) => r.statusCode)).toEqual([400, 400, 400, 400]);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ tenantId: 'tenant-a', ...body });
  });

  it('rotas /destinations removidas', async () => {
    const put = await app.inject({ method: 'PUT', url: `${PREFIX}/destinations`, payload: { conversationIds: [] } });
    expect(put.statusCode).toBe(404);
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
      payload: { priceCents: null, text: 'oi', imageUploadId: UPLOAD_ID, coupon: 'X', audience: 'MEN', mentionAll: true },
    });
    const neg = await app.inject({ method: 'PATCH', url: `${PREFIX}/offer-1`, payload: { priceCents: -1 } });
    const up = await app.inject({ method: 'PATCH', url: `${PREFIX}/offer-1`, payload: { imageUploadId: '../x' } });
    expect(ok.statusCode).toBe(200);
    expect(neg.statusCode).toBe(400);
    expect(up.statusCode).toBe(400);
    expect(update).toHaveBeenCalledWith({
      tenantId: 'tenant-a', userId: 'user-a', offerId: 'offer-1',
      priceCents: null, text: 'oi', imageUploadId: UPLOAD_ID, coupon: 'X', audience: 'MEN', mentionAll: true,
    });
  });

  it('POST /:id/regenerate com e sem corpo → 200 { offer, aiFallback }', async () => {
    const regen = vi.spyOn(RegenerateOfferTextUseCase.prototype, 'execute').mockResolvedValue({ offer: dto(), aiFallback: false });
    const withBody = await app.inject({ method: 'POST', url: `${PREFIX}/offer-1/regenerate`, payload: { audience: 'FITNESS' } });
    const noBody = await app.inject({ method: 'POST', url: `${PREFIX}/offer-1/regenerate` });
    const bad = await app.inject({ method: 'POST', url: `${PREFIX}/offer-1/regenerate`, payload: { audience: 'X' } });
    expect(withBody.statusCode).toBe(200);
    expect(withBody.json()).toEqual({ success: true, data: { offer: dto(), aiFallback: false } });
    expect(noBody.statusCode).toBe(200);
    expect(bad.statusCode).toBe(400);
    expect(regen).toHaveBeenNthCalledWith(1, { tenantId: 'tenant-a', offerId: 'offer-1', audience: 'FITNESS' });
    expect(regen).toHaveBeenNthCalledWith(2, { tenantId: 'tenant-a', offerId: 'offer-1', audience: undefined });
  });

  it('POST /:id/send → 202 { offer, dispatches }', async () => {
    vi.spyOn(SendOfferUseCase.prototype, 'execute').mockResolvedValue({ offer: dto(), dispatches: [] });
    const res = await app.inject({ method: 'POST', url: `${PREFIX}/offer-1/send` });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ success: true, data: { offer: dto(), dispatches: [] } });
  });
});
