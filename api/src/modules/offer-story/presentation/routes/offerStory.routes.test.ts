import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { offerStoryRoutes } from './offerStory.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { rateLimitPresets } from '../../../../shared/http/rateLimitPresets';
import { OFFER_STORY_TEMPLATES } from '../../domain/offerStoryTemplates';
import type { OfferStoryFakes } from '../../application/use-cases/offerStoryTestFakes';

/*
 * Contrato HTTP (padrão storefront.routes.test): Fastify de verdade, sem banco. Container trocado por
 * use cases reais sobre fakes (renderer real fica no teste do adapter); auth falso e tenant por header.
 */
const holder = vi.hoisted(() => ({ fakes: null as unknown as OfferStoryFakes, gateOff: false }));
vi.mock('../../infrastructure/offerStoryContainer', async () => {
  const { makeOfferStoryDeps } = await import('../../application/use-cases/offerStoryTestFakes');
  const { ListOfferStoryTemplatesUseCase } = await import('../../application/use-cases/ListOfferStoryTemplatesUseCase');
  const { RenderOfferStoryUseCase: Render } = await import('../../application/use-cases/RenderOfferStoryUseCase');
  const { ENTITLEMENT_KEYS } = await import('../../../tenants/domain/entitlementKeys');
  return {
    offerStoryContainer: {
      useCases: () => {
        const { deps, fakes } = makeOfferStoryDeps();
        holder.fakes = fakes;
        if (holder.gateOff) fakes.entitlements.values = { [ENTITLEMENT_KEYS.OFFER_STORY_ENABLED]: false };
        return { listTemplates: new ListOfferStoryTemplatesUseCase(deps), render: new Render(deps) };
      },
    },
  };
});
vi.mock('../../../../shared/http/hooks/authHook', async () => {
  const { UnauthorizedError } = await import('../../../../shared/errors/internal/AuthErrors');
  return {
    authHook: async (request: { headers: Record<string, unknown>; user?: unknown }) => {
      if (!request.headers.authorization) throw new UnauthorizedError();
      request.user = { userId: 'user-a', isSuperAdmin: false };
    },
  };
});
vi.mock('../../../../shared/http/hooks/tenantHook', () => ({
  tenantHook: async (request: { headers: Record<string, unknown>; tenantContext?: unknown }) => {
    const tenantId = (request.headers['x-tenant-id'] as string | undefined) ?? 'tenant-a';
    request.tenantContext = { userId: 'user-a', tenantId, role: 'ADMIN', isSuperAdmin: false };
  },
}));

const PREFIX = '/api/offer-story';
const AUTH = { authorization: 'Bearer x' };
const body = { templateId: OFFER_STORY_TEMPLATES[0].id, url: 'https://meli.la/abc' };

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute', keyGenerator: (r) => r.ip });
  await app.register(offerStoryRoutes, { prefix: PREFIX });
  await app.ready();
});

afterEach(async () => {
  holder.gateOff = false;
  vi.restoreAllMocks();
  await app.close();
});

describe('GET /offer-story/templates', () => {
  it('sem auth → 401', async () => {
    expect((await app.inject({ method: 'GET', url: `${PREFIX}/templates` })).statusCode).toBe(401);
  });

  it('200: catálogo só com id e nome', async () => {
    const res = await app.inject({ method: 'GET', url: `${PREFIX}/templates`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { templates: OFFER_STORY_TEMPLATES.map(({ id, name }) => ({ id, name })) } });
  });
});

describe('POST /offer-story/render', () => {
  it('200: arte em data URL e metadados', async () => {
    const res = await app.inject({ method: 'POST', url: `${PREFIX}/render`, headers: AUTH, payload: { ...body, coupon: { code: 'PROMO', discountPercent: 10 } } });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.image).toMatch(/^data:image\/jpeg;base64,/);
    expect(data).toMatchObject({ width: 1080, height: 1920, provider: 'MERCADO_LIVRE', coupon: { code: 'PROMO', discountPercent: 10 }, warnings: [] });
    expect(holder.fakes.resolveProduct.calls).toEqual([['tenant-a', body.url]]);
  });

  it.each([['templates', 'GET'], ['render', 'POST']] as const)('plano sem o story: %s → 403 PLAN_FEATURE_UNAVAILABLE', async (path, method) => {
    holder.gateOff = true;
    const res = await app.inject({ method, url: `${PREFIX}/${path}`, headers: AUTH, ...(method === 'POST' ? { payload: body } : {}) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PLAN_FEATURE_UNAVAILABLE');
  });

  it.each([
    ['sem url', { templateId: 'x' }],
    ['desconto sem código', { ...body, coupon: { discountPercent: 10 } }],
    ['desconto 91', { ...body, coupon: { code: 'A', discountPercent: 91 } }],
    ['desconto fracionado', { ...body, coupon: { code: 'A', discountPercent: 10.5 } }],
    ['código > 60', { ...body, coupon: { code: 'A'.repeat(61) } }],
  ])('schema: %s → 400', async (_l, payload) => {
    const res = await app.inject({ method: 'POST', url: `${PREFIX}/render`, headers: AUTH, payload });
    expect(res.statusCode).toBe(400);
  });

  it('rate limit por tenant: 61ª arte → 429 RATE_LIMITED; outro tenant segue livre', async () => {
    const send = (tenant: string) =>
      app.inject({ method: 'POST', url: `${PREFIX}/render`, headers: { ...AUTH, 'x-tenant-id': tenant }, payload: body });
    for (let i = 0; i < rateLimitPresets.offerStoryRender.max; i++) expect((await send('tenant-a')).statusCode).toBe(200);
    const limited = await send('tenant-a');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatchObject({ code: 'RATE_LIMITED', meta: { retryAfterSeconds: expect.any(Number) } });
    expect((await send('tenant-b')).statusCode).toBe(200);
  });
});
