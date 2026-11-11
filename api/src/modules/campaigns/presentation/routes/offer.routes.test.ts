import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { offerRoutes } from './offer.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { rateLimitPresets } from '../../../../shared/http/rateLimitPresets';
import { GenerateOfferUseCase } from '../../application/use-cases/GenerateOfferUseCase';
import { GetOfferUseCase } from '../../application/use-cases/GetOfferUseCase';
import { GetOfferUsageUseCase } from '../../application/use-cases/GetOfferUsageUseCase';
import { UpdateOfferUseCase } from '../../application/use-cases/UpdateOfferUseCase';
import { SendOfferUseCase } from '../../application/use-cases/SendOfferUseCase';
import { CancelOfferUseCase, PauseOfferUseCase, ResumeOfferUseCase } from '../../application/use-cases/OfferSendControlUseCases';
import { OfferInvalidStateError } from '../../../../shared/errors/internal/OfferErrors';
import { RegenerateOfferTextUseCase } from '../../application/use-cases/RegenerateOfferTextUseCase';
import {
  GetOfferGeneratorConfigUseCase,
  SaveOfferGeneratorConfigUseCase,
  type OfferGeneratorConfigDTO,
} from '../../application/use-cases/OfferGeneratorConfigUseCases';
import {
  AffiliateApiRateLimitedError,
  AffiliateCredentialRejectedError,
  AffiliateCredentialRequiredError,
  OfferLinkRebuildFailedError,
  OfferNotFoundError,
} from '../../../../shared/errors/internal/OfferErrors';
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
  tenantHook: async (request: { headers: Record<string, unknown>; tenantContext?: unknown }) => {
    const tenantId = (request.headers['x-tenant-id'] as string | undefined) ?? 'tenant-a';
    request.tenantContext = { userId: 'user-a', tenantId, role: 'ADMIN', isSuperAdmin: false };
  },
}));

const PREFIX = '/api/campaigns/offers';
const UPLOAD_ID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';

const CONFIG: OfferGeneratorConfigDTO = {
  sessionIds: ['s1'], intervalMinSeconds: 120, intervalMaxSeconds: 300, dispatchOrder: 'SEQUENTIAL',
  windowStartMinute: 0, windowEndMinute: 1440, weekdays: [0, 1, 2, 3, 4, 5, 6],
  groups: [{ id: 'g1', title: 'Grupo', avatarUrl: null, sessionId: 's1', canPost: false, postBlockedReason: 'ADMINS_ONLY' }], groupLimit: null, sessionLimit: null, crossSessionDispatch: false, mentionAllEnabled: true, aiRewriteEnabled: true, configured: true,
  limits: { whatsapp: { sessions: null, broadcastGroups: null }, telegram: { sessions: null, broadcastGroups: null } },
  usage: { whatsapp: { sessions: 1, broadcastGroups: 1 }, telegram: { sessions: 0, broadcastGroups: 0 } },
};

function dto(): OfferDTO {
  return JSON.parse(JSON.stringify(toOfferDto(makeOffer())));
}

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify();
  app.setErrorHandler(errorHandler);
  // Global por IP alto, como o app; o preset por tenant da geração vem da rota
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute', keyGenerator: (r) => r.ip });
  await app.register(offerRoutes, { prefix: PREFIX });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('POST /', () => {
  it('201 com { offer, needsManualData, aiFallback, aiErrorCode, linkRebuilt } e contexto do tenant', async () => {
    const data = { offer: dto(), needsManualData: true, aiFallback: true, aiErrorCode: 'AI_NOT_CONFIGURED', linkRebuilt: true };
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

  it.each([
    ['AFFILIATE_CREDENTIAL_REQUIRED', new AffiliateCredentialRequiredError('SHOPEE')],
    ['AFFILIATE_CREDENTIAL_REJECTED', new AffiliateCredentialRejectedError('SHOPEE')],
    ['OFFER_LINK_REBUILD_FAILED', new OfferLinkRebuildFailedError('MERCADO_LIVRE', 'ML_100')],
  ])('%s → 422 com código e provider', async (code, err) => {
    vi.spyOn(GenerateOfferUseCase.prototype, 'execute').mockRejectedValue(err);
    const res = await app.inject({ method: 'POST', url: `${PREFIX}/`, payload: { url: 'https://amzn.to/x' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code, meta: { provider: expect.any(String) } });
  });

  it('limite da loja ao recriar → 429 AFFILIATE_API_RATE_LIMITED', async () => {
    vi.spyOn(GenerateOfferUseCase.prototype, 'execute').mockRejectedValue(new AffiliateApiRateLimitedError('MERCADO_LIVRE'));
    const res = await app.inject({ method: 'POST', url: `${PREFIX}/`, payload: { url: 'https://meli.la/x' } });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('AFFILIATE_API_RATE_LIMITED');
  });

  it('rate limit por tenant: geração além do preset → 429 RATE_LIMITED; outro tenant segue livre', async () => {
    const data = { offer: dto(), needsManualData: false, aiFallback: false, linkRebuilt: false };
    const execute = vi.spyOn(GenerateOfferUseCase.prototype, 'execute').mockResolvedValue(data);
    const send = (tenant: string) =>
      app.inject({ method: 'POST', url: `${PREFIX}/`, headers: { 'x-tenant-id': tenant }, payload: { url: 'https://amzn.to/x' } });
    for (let i = 0; i < rateLimitPresets.offerGenerate.max; i++) expect((await send('tenant-a')).statusCode).toBe(201);
    const limited = await send('tenant-a');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatchObject({ code: 'RATE_LIMITED', meta: { retryAfterSeconds: expect.any(Number) } });
    expect(execute).toHaveBeenCalledTimes(rateLimitPresets.offerGenerate.max);
    expect((await send('tenant-b')).statusCode).toBe(201);
    // O limite é só da geração: as demais rotas do gerador seguem livres para o mesmo tenant
    vi.spyOn(GetOfferUsageUseCase.prototype, 'execute').mockResolvedValue({ used: 0, limit: null });
    expect((await app.inject({ method: 'GET', url: `${PREFIX}/usage`, headers: { 'x-tenant-id': 'tenant-a' } })).statusCode).toBe(200);
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
    vi.spyOn(GenerateOfferUseCase.prototype, 'execute').mockResolvedValue({ offer, needsManualData: false, aiFallback: false, linkRebuilt: false });
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
    // Inclui `limits`/`usage` por canal: o schema de resposta não pode descartá-los
    expect(res.json()).toEqual({ success: true, data: CONFIG });
    expect(vi_).toHaveBeenCalledWith('tenant-a');
    expect(getOffer).not.toHaveBeenCalled();
  });

  it('PUT /config repassa; intervalo fora de 60–3600 s, sem campo ou > 200 grupos → 400', async () => {
    const save = vi.spyOn(SaveOfferGeneratorConfigUseCase.prototype, 'execute').mockResolvedValue(CONFIG);
    const body = { sessionIds: ['s1'], intervalMinSeconds: 120, intervalMaxSeconds: 300, dispatchOrder: 'SEQUENTIAL', conversationIds: ['g1'] };
    const ok = await app.inject({ method: 'PUT', url: `${PREFIX}/config`, payload: body });
    const bad = await Promise.all([
      { ...body, intervalMinSeconds: 59 },
      { ...body, intervalMaxSeconds: 3601 },
      { ...body, sessionIds: [] },
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
      payload: { priceCents: null, text: 'oi', imageUploadId: UPLOAD_ID, coupon: 'X', audience: 'MEN', mentionAll: true, imageMode: 'LINK_PREVIEW' },
    });
    const neg = await app.inject({ method: 'PATCH', url: `${PREFIX}/offer-1`, payload: { priceCents: -1 } });
    const up = await app.inject({ method: 'PATCH', url: `${PREFIX}/offer-1`, payload: { imageUploadId: '../x' } });
    const mode = await app.inject({ method: 'PATCH', url: `${PREFIX}/offer-1`, payload: { imageMode: 'GIF' } });
    expect(ok.statusCode).toBe(200);
    expect(neg.statusCode).toBe(400);
    expect(up.statusCode).toBe(400);
    expect(mode.statusCode).toBe(400);
    expect(ok.json().data.imageMode).toBe('MEDIA');
    expect(update).toHaveBeenCalledWith({
      tenantId: 'tenant-a', userId: 'user-a', offerId: 'offer-1',
      priceCents: null, text: 'oi', imageUploadId: UPLOAD_ID, coupon: 'X', audience: 'MEN', mentionAll: true, imageMode: 'LINK_PREVIEW',
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

  it('POST /:id/pause|resume|cancel → 200 oferta; estado errado → 409 OFFER_INVALID_STATE', async () => {
    const paused = { ...dto(), status: 'PAUSED' as const };
    vi.spyOn(PauseOfferUseCase.prototype, 'execute').mockResolvedValue(paused);
    vi.spyOn(ResumeOfferUseCase.prototype, 'execute').mockRejectedValue(new OfferInvalidStateError('offer-1', 'SENT'));
    const cancel = vi.spyOn(CancelOfferUseCase.prototype, 'execute').mockResolvedValue({ ...dto(), status: 'CANCELLED' as const });

    const pause = await app.inject({ method: 'POST', url: `${PREFIX}/offer-1/pause` });
    expect(pause.statusCode).toBe(200);
    expect(pause.json().data.status).toBe('PAUSED');

    const resume = await app.inject({ method: 'POST', url: `${PREFIX}/offer-1/resume` });
    expect(resume.statusCode).toBe(409);
    expect(resume.body).toContain('OFFER_INVALID_STATE');

    const stop = await app.inject({ method: 'POST', url: `${PREFIX}/offer-1/cancel` });
    expect(stop.statusCode).toBe(200);
    expect(cancel).toHaveBeenCalledWith({ tenantId: 'tenant-a', offerId: 'offer-1' });
  });
});
