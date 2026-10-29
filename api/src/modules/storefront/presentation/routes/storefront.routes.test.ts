import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { storefrontRoutes } from './storefront.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { rateLimitPresets } from '../../../../shared/http/rateLimitPresets';
import { PrismaEntitlementReader } from '../../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { GetStorefrontUseCase } from '../../application/use-cases/GetStorefrontUseCase';
import { PreviewStorefrontUseCase } from '../../application/use-cases/PreviewStorefrontUseCase';
import { SetStorefrontImageUseCase } from '../../application/use-cases/SetStorefrontImageUseCase';
import { CheckStorefrontSlugUseCase } from '../../application/use-cases/CheckStorefrontSlugUseCase';
import { StorefrontOfferStatus, StorefrontStatus } from '../../domain/enums/StorefrontEnums';
import type { StorefrontOffer } from '../../domain/entities/StorefrontOffer';
import type { Storefront } from '../../domain/entities/Storefront';

/*
 * Contrato HTTP (padrão linkRotation.routes.test): Fastify de verdade, sem banco. Prisma vazio;
 * auth falso (sem `authorization` → 401) e tenant pelo header `x-tenant-id`.
 */
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
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

const PREFIX = '/api/storefront';
const T0 = new Date('2026-10-29T12:00:00.000Z');
const AUTH = { authorization: 'Bearer x' };

const page: Storefront = {
  id: 'sf-1', tenantId: 'tenant-a', title: 'Achados da Ana', subtitle: null, avatarUrl: null, coverUrl: null,
  colorPrimary: '#15803D', colorBackground: '#F6F7F9', colorCard: '#FFFFFF', categories: ['casa'],
  status: StorefrontStatus.ACTIVE, address: { domainId: 'dom-1', slug: 'ana' }, createdAt: T0, updatedAt: T0,
};

const offer: StorefrontOffer = {
  id: 'of-1', tenantId: 'tenant-a', storefrontId: 'sf-1', status: StorefrontOfferStatus.DRAFT, position: 0,
  provider: 'SHOPEE', sourceUrl: 'https://s.shopee.com.br/x', affiliateUrl: 'https://s.shopee.com.br/x',
  attributionVerified: false, title: 'Air fryer', priceCents: 19990, originalPriceCents: 29990, imageUrl: null,
  category: null, publishedAt: null, createdAt: T0, updatedAt: T0,
};

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute', keyGenerator: (r) => r.ip });
  await app.register(storefrontRoutes, { prefix: PREFIX });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

const draft = { title: 'Achados', colorPrimary: '#000000', colorBackground: '#FFFFFF', colorCard: '#FFFFFF', categories: [] };

describe('GET /storefront', () => {
  it('sem auth responde 401', async () => {
    const res = await app.inject({ method: 'GET', url: PREFIX });
    expect(res.statusCode).toBe(401);
  });

  it('plano sem a página responde 403 PLAN_FEATURE_UNAVAILABLE', async () => {
    vi.spyOn(PrismaEntitlementReader.prototype, 'getBoolean').mockResolvedValue(false);
    const res = await app.inject({ method: 'GET', url: PREFIX, headers: AUTH });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE' });
  });

  it('200: página com endereço, ofertas com attributionVerified e sem tenantId', async () => {
    const execute = vi.spyOn(GetStorefrontUseCase.prototype, 'execute').mockResolvedValue({
      storefront: page,
      publicUrl: 'https://ana.copysync.com.br',
      offers: { drafts: [offer], published: [] },
      categories: [{ key: 'casa', label: 'Casa' }],
      subtitleSuggestions: ['Achados do dia'],
      domains: [{ id: 'dom-1', hostname: 'copysync.com.br' }],
    });
    const res = await app.inject({ method: 'GET', url: PREFIX, headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledWith('tenant-a');
    const data = res.json().data;
    expect(data.storefront).toMatchObject({ id: 'sf-1', domainId: 'dom-1', slug: 'ana', createdAt: T0.toISOString() });
    expect(data.storefront.tenantId).toBeUndefined();
    expect(data.offers.drafts[0]).toMatchObject({ id: 'of-1', attributionVerified: false, publishedAt: null });
    expect(data.offers.drafts[0].tenantId).toBeUndefined();
    expect(data.publicUrl).toBe('https://ana.copysync.com.br');
  });

  it('sem página: storefront null', async () => {
    vi.spyOn(GetStorefrontUseCase.prototype, 'execute').mockResolvedValue({
      storefront: null, publicUrl: null, offers: { drafts: [], published: [] }, categories: [], subtitleSuggestions: [], domains: [],
    });
    const res = await app.inject({ method: 'GET', url: PREFIX, headers: AUTH });
    expect(res.json().data.storefront).toBeNull();
  });
});

describe('POST /storefront/preview', () => {
  it('devolve { data: { html } } e viewport padrão mobile', async () => {
    const execute = vi.spyOn(PreviewStorefrontUseCase.prototype, 'execute').mockResolvedValue({ html: '<!doctype html><p>ok</p>' });
    const res = await app.inject({ method: 'POST', url: `${PREFIX}/preview`, headers: AUTH, payload: draft });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toEqual({ success: true, data: { html: '<!doctype html><p>ok</p>' } });
    expect(execute).toHaveBeenCalledWith({ tenantId: 'tenant-a', draft, viewport: 'mobile' });
  });

  it('sem título → 400 sem chegar ao use case', async () => {
    const execute = vi.spyOn(PreviewStorefrontUseCase.prototype, 'execute');
    const { title: _t, ...noTitle } = draft;
    const res = await app.inject({ method: 'POST', url: `${PREFIX}/preview`, headers: AUTH, payload: noTitle });
    expect(res.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('plano sem a página → 403 propagado', async () => {
    vi.spyOn(PrismaEntitlementReader.prototype, 'getBoolean').mockResolvedValue(false);
    const res = await app.inject({ method: 'POST', url: `${PREFIX}/preview`, headers: AUTH, payload: draft });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PLAN_FEATURE_UNAVAILABLE');
  });

  it('rate limit por tenant: 61ª prévia → 429 RATE_LIMITED; outro tenant segue livre', async () => {
    vi.spyOn(PreviewStorefrontUseCase.prototype, 'execute').mockResolvedValue({ html: '' });
    const send = (tenant: string) =>
      app.inject({ method: 'POST', url: `${PREFIX}/preview`, headers: { ...AUTH, 'x-tenant-id': tenant }, payload: draft });
    for (let i = 0; i < rateLimitPresets.storefrontPreview.max; i++) expect((await send('tenant-a')).statusCode).toBe(200);
    const limited = await send('tenant-a');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatchObject({ code: 'RATE_LIMITED', meta: { retryAfterSeconds: expect.any(Number) } });
    expect((await send('tenant-b')).statusCode).toBe(200);
  });
});

describe('demais rotas', () => {
  it('rate limit do nome sem auth: 401 antes de contar', async () => {
    const res = await app.inject({ method: 'GET', url: `${PREFIX}/slug-availability?slug=ana` });
    expect(res.statusCode).toBe(401);
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('slug-availability repassa slug e domainId com o tenant', async () => {
    const execute = vi.spyOn(CheckStorefrontSlugUseCase.prototype, 'execute').mockResolvedValue({ status: 'AVAILABLE', slug: 'ana', suggestions: [] });
    const res = await app.inject({ method: 'GET', url: `${PREFIX}/slug-availability?slug=ana&domainId=dom-1`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe(String(rateLimitPresets.storefrontSlug.max));
    expect(execute).toHaveBeenCalledWith({ tenantId: 'tenant-a', slug: 'ana', domainId: 'dom-1' });
    expect(res.json().data).toEqual({ status: 'AVAILABLE', slug: 'ana', suggestions: [] });
  });

  it('PUT /images/:kind leva o userId do auth', async () => {
    const execute = vi.spyOn(SetStorefrontImageUseCase.prototype, 'execute').mockResolvedValue({ url: 'https://m/x.webp' });
    const uploadId = '0b5c6a7e-1f2d-4c3b-8a9e-0123456789ab';
    const res = await app.inject({ method: 'PUT', url: `${PREFIX}/images/avatar`, headers: AUTH, payload: { uploadId } });
    expect(res.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledWith({ tenantId: 'tenant-a', userId: 'user-a', kind: 'avatar', uploadId });
  });

  it('kind fora de avatar/cover → 400', async () => {
    const res = await app.inject({ method: 'DELETE', url: `${PREFIX}/images/banner`, headers: AUTH });
    expect(res.statusCode).toBe(400);
  });

  it('reordenar com status inválido → 400', async () => {
    const res = await app.inject({ method: 'PUT', url: `${PREFIX}/offers/order`, headers: AUTH, payload: { status: 'ARCHIVED', ids: [] } });
    expect(res.statusCode).toBe(400);
  });
});
