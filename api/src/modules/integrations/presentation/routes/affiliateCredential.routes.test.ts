import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { UnauthorizedError } from '../../../../shared/errors/internal/AuthErrors';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { PrismaEntitlementReader } from '../../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { PrismaPlanEntitlementPresetRepository } from '../../../tenants/infrastructure/repositories/PrismaPlanEntitlementPresetRepository';
import { PrismaMarketplaceRiskAcceptanceRepository } from '../../infrastructure/repositories/PrismaMarketplaceRiskAcceptanceRepository';
import { PrismaAffiliateCredentialRepository } from '../../infrastructure/repositories/PrismaAffiliateCredentialRepository';
import { PrismaFeatureAudienceRepository } from '../../../tenants/infrastructure/repositories/PrismaFeatureAudienceRepository';
import { SecretCipherFactory } from '../../../../shared/security/SecretCipherFactory';
import { AesGcmSecretCipher } from '../../../../shared/security/AesGcmSecretCipher';
import { MARKETPLACE_RISK_NOTICE_VERSION } from '../../domain/services/marketplaceRiskNotice';
import { affiliateCredentialItemSchema } from '../schemas/affiliateCredential.schema';
import { affiliateCredentialRoutes } from './affiliateCredential.routes';

vi.mock('../../../../shared/database/prisma.client', () => ({
  prisma: {
    userTenant: { findUnique: async () => ({ role: 'ADMIN', tenant: { status: 'ACTIVE' } }) },
    tenant: { findUnique: async () => ({ id: 't1', status: 'ACTIVE' }) },
  },
}));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { headers: Record<string, unknown>; user?: unknown }) => {
    const auth = request.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) throw new UnauthorizedError('Invalid or expired access token');
    // token `sa` = super admin (do token, não do papel no tenant)
    request.user = { userId: auth.slice(7), isSuperAdmin: auth === 'Bearer sa' };
  },
}));

const VERSION = MARKETPLACE_RISK_NOTICE_VERSION.SHEIN!;
const AT = new Date('2026-11-10T12:00:00.000Z');
const headers = { authorization: 'Bearer u1', 'x-tenant-id': 't1' };
const saHeaders = { authorization: 'Bearer sa', 'x-tenant-id': 't1' };
let app: FastifyInstance;
let audience: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  // Nada gravado em `platform_settings.feature_audience`: Kabum/Magalu/AliExpress ficam "Só super admin".
  audience = vi.spyOn(PrismaFeatureAudienceRepository.prototype, 'get').mockResolvedValue({});
  app = Fastify();
  app.setErrorHandler(errorHandler);
  app.addSchema(affiliateCredentialItemSchema);
  await app.register(affiliateCredentialRoutes, { prefix: '/api/integrations/affiliate-credentials' });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

type Method = 'GET' | 'PUT' | 'DELETE' | 'PATCH' | 'POST';
const call = (method: Method, path: string, payload?: Record<string, unknown>, h: Record<string, string> = headers) =>
  app.inject({ method, url: `/api/integrations/affiliate-credentials${path}`, headers: h, ...(payload && { payload }) });

describe('rotas genéricas recusam a Shein (ID segue a sessão)', () => {
  it('PUT /SHEIN/session → 422, sem gravar', async () => {
    const upsert = vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'upsertSession');
    const res = await call('PUT', '/SHEIN/session', { cookies: { AT: 'x', memberId: '4320454940' }, capturedAt: 'now' });
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'AFFILIATE_CREDENTIAL_INVALID']);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('PUT /SHEIN → 422, sem gravar', async () => {
    const upsert = vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'upsert');
    const res = await call('PUT', '/SHEIN', { publicIdentifier: '4320454940' });
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'AFFILIATE_CREDENTIAL_INVALID']);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('DELETE /SHEIN → 409 USE_MARKETPLACE_DISCONNECT, sem apagar; outros seguem genéricos', async () => {
    const del = vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'delete').mockResolvedValue(true);
    vi.spyOn(PrismaAuditLogRepository.prototype, 'create').mockResolvedValue(undefined);
    const res = await call('DELETE', '/SHEIN');
    expect([res.statusCode, res.json().error.code]).toEqual([409, 'USE_MARKETPLACE_DISCONNECT']);
    expect(del).not.toHaveBeenCalled();
    expect((await call('DELETE', '/AMAZON')).statusCode).toBe(204);
    expect(del).toHaveBeenCalledWith('t1', 'AMAZON');
  });
});

describe('GET / — marketplaceAvailability', () => {
  it('enabled do tenant, planos do preset e riskNotice só onde há aviso', async () => {
    vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'listByTenant').mockResolvedValue([]);
    vi.spyOn(PrismaEntitlementReader.prototype, 'getBoolean').mockResolvedValue(false);
    vi.spyOn(PrismaEntitlementReader.prototype, 'getNumber').mockResolvedValue(null);
    const presets = vi.spyOn(PrismaPlanEntitlementPresetRepository.prototype, 'listByKeys').mockResolvedValue([
      { planSlug: 'COPYSYNC_MAX', key: 'marketplace_shein_enabled', value: true },
      { planSlug: 'COPYSYNC_PRO', key: 'marketplace_shein_enabled', value: false },
      { planSlug: 'COPYSYNC_LITE', key: 'marketplace_shein_enabled', value: null },
      { planSlug: 'COPYSYNC_MAX', key: 'marketplace_kabum_enabled', value: true },
      { planSlug: 'COPYSYNC_MAX', key: 'marketplace_magalu_enabled', value: true },
      { planSlug: 'COPYSYNC_PRO', key: 'marketplace_aliexpress_enabled', value: false },
      { planSlug: 'COPYSYNC_MAX', key: 'marketplace_aliexpress_enabled', value: true },
    ]);
    vi.spyOn(PrismaMarketplaceRiskAcceptanceRepository.prototype, 'findCurrent').mockResolvedValue({
      id: 'a1', tenantId: 't1', provider: 'SHEIN', scope: 'AFFILIATE_LINK', noticeVersion: VERSION, acceptedByUserId: 'sa', locale: 'pt-BR', acceptedAt: AT,
    });

    const res = await call('GET', '/', undefined, saHeaders);
    expect(res.statusCode).toBe(200);
    expect(presets).toHaveBeenCalledWith([
      'marketplace_shein_enabled', 'marketplace_kabum_enabled', 'marketplace_magalu_enabled', 'marketplace_aliexpress_enabled',
    ]);
    const open = { enabled: true, plans: [], riskNotice: null };
    const maxOnly = { enabled: false, plans: ['COPYSYNC_MAX'], riskNotice: null };
    expect(res.json().data).toEqual({
      items: [],
      marketplaceAvailability: {
        SHOPEE: open,
        MERCADO_LIVRE: open,
        AMAZON: open,
        SHEIN: { enabled: false, plans: ['COPYSYNC_MAX'], riskNotice: { version: VERSION, acceptedAt: AT.toISOString(), acceptedByMe: true } },
        // super admin vê as lojas "Só super admin"; chave de plano igual à da Shein (só MAX)
        KABUM: maxOnly,
        MAGALU: maxOnly,
        ALIEXPRESS: maxOnly,
      },
    });
  });

  it('sem aceite da versão vigente: acceptedAt null; aceite de outro usuário: acceptedByMe false', async () => {
    vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'listByTenant').mockResolvedValue([]);
    vi.spyOn(PrismaEntitlementReader.prototype, 'getBoolean').mockResolvedValue(true);
    vi.spyOn(PrismaEntitlementReader.prototype, 'getNumber').mockResolvedValue(null);
    vi.spyOn(PrismaPlanEntitlementPresetRepository.prototype, 'listByKeys').mockResolvedValue([]);
    const find = vi.spyOn(PrismaMarketplaceRiskAcceptanceRepository.prototype, 'findCurrent').mockResolvedValue(null);
    const none = (await call('GET', '/')).json().data.marketplaceAvailability.SHEIN;
    expect(none).toEqual({ enabled: true, plans: [], riskNotice: { version: VERSION, acceptedAt: null, acceptedByMe: false } });
    expect(find).toHaveBeenCalledWith('t1', 'SHEIN', 'AFFILIATE_LINK', VERSION);

    find.mockResolvedValue({ id: 'a1', tenantId: 't1', provider: 'SHEIN', scope: 'AFFILIATE_LINK', noticeVersion: VERSION, acceptedByUserId: 'u9', locale: 'pt-BR', acceptedAt: AT });
    expect((await call('GET', '/')).json().data.marketplaceAvailability.SHEIN.riskNotice.acceptedByMe).toBe(false);
  });
});

const NOW = new Date('2026-11-11T12:00:00.000Z');
const mlRecord = {
  id: 'c1', tenantId: 't1', provider: 'MERCADO_LIVRE' as const, publicIdentifier: 'loja', hasSecret: false, hasSession: true,
  sessionSyncedAt: NOW, sessionInvalidAt: null, sessionAccountHash: null, sessionAccountKeyVersion: null,
  status: 'ACTIVE' as const, lastValidatedAt: null, rejectedAt: null, rejectedCode: null,
  accountIdentifiers: ['loja', 'promo', 'cupom'], linkedIdentifiers: ['promo'],
  createdAt: NOW, updatedAt: NOW, secret: null, session: null,
};

describe('GET|PUT /:provider/identifiers', () => {
  it('sem token → 401, nada lido', async () => {
    const find = vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'findByTenantAndProvider');
    const res = await app.inject({ method: 'GET', url: '/api/integrations/affiliate-credentials/MERCADO_LIVRE/identifiers' });
    expect(res.statusCode).toBe(401);
    expect(find).not.toHaveBeenCalled();
  });

  it('GET → formato da resposta e leitura pelo tenant do contexto', async () => {
    const find = vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'findByTenantAndProvider').mockResolvedValue(mlRecord);
    vi.spyOn(PrismaEntitlementReader.prototype, 'getNumber').mockResolvedValue(2);
    const res = await call('GET', '/MERCADO_LIVRE/identifiers');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ account: ['loja', 'promo', 'cupom'], primary: 'loja', linked: ['promo'], limit: 2, used: 2 });
    expect(find).toHaveBeenCalledWith('t1', 'MERCADO_LIVRE');
  });

  it('PUT grava e devolve o novo estado; auditoria sem etiquetas', async () => {
    vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'findByTenantAndProvider').mockResolvedValue(mlRecord);
    vi.spyOn(PrismaEntitlementReader.prototype, 'getNumber').mockResolvedValue(10);
    const set = vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'setIdentifiers')
      .mockResolvedValue({ ...mlRecord, publicIdentifier: 'cupom', linkedIdentifiers: ['loja', 'promo'] });
    const audit = vi.spyOn(PrismaAuditLogRepository.prototype, 'create').mockResolvedValue(undefined);
    const res = await call('PUT', '/MERCADO_LIVRE/identifiers', { primary: 'cupom', linked: ['loja', 'promo'] });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ account: ['loja', 'promo', 'cupom'], primary: 'cupom', linked: ['loja', 'promo'], limit: 10, used: 3 });
    expect(set).toHaveBeenCalledWith('t1', 'MERCADO_LIVRE', 'cupom', ['loja', 'promo']);
    expect(audit.mock.calls[0][0]).toMatchObject({ action: 'AFFILIATE_CREDENTIAL_UPSERTED', meta: { provider: 'MERCADO_LIVRE', identifiersChanged: true } });
  });

  it('PUT acima do limite → 403 PLAN_LIMIT_REACHED; body inválido → 400', async () => {
    vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'findByTenantAndProvider').mockResolvedValue(mlRecord);
    vi.spyOn(PrismaEntitlementReader.prototype, 'getNumber').mockResolvedValue(1);
    const set = vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'setIdentifiers');
    const res = await call('PUT', '/MERCADO_LIVRE/identifiers', { primary: 'loja', linked: ['promo'] });
    expect([res.statusCode, res.json().error.code]).toEqual([403, 'PLAN_LIMIT_REACHED']);
    expect(res.json().error.meta).toMatchObject({ key: 'mercado_livre_affiliate_tags', limit: 1 });
    expect((await call('PUT', '/MERCADO_LIVRE/identifiers', { primary: 'loja' })).statusCode).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });

  it('provider sem lista da conta → 422', async () => {
    const res = await call('GET', '/SHOPEE/identifiers');
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'AFFILIATE_CREDENTIAL_INVALID']);
  });
});

const HIDDEN = ['KABUM', 'MAGALU', 'ALIEXPRESS'] as const;
const record = (provider: (typeof HIDDEN)[number] | 'SHOPEE') => ({ ...mlRecord, provider, accountIdentifiers: [], linkedIdentifiers: [], hasSession: false });

/** As 7 rotas por `:provider`, cada uma com corpo válido. */
const PROVIDER_ROUTES: Array<[Method, string, Record<string, unknown> | undefined]> = [
  ['PUT', '', { publicIdentifier: '1234567' }],
  ['DELETE', '', undefined],
  ['PATCH', '/status', { status: 'INACTIVE' }],
  ['PUT', '/session', { cookies: { a: 'b' }, capturedAt: 'now' }],
  ['GET', '/identifiers', undefined],
  ['PUT', '/identifiers', { primary: 'x', linked: [] }],
  ['POST', '/risk-acceptance', { noticeVersion: 'v1', locale: 'pt-BR' }],
];

describe('audiência "Só super admin" das lojas novas', () => {
  const repoMethods = ['listByTenant', 'findByTenantAndProvider', 'upsert', 'upsertSession', 'delete', 'setStatus', 'setIdentifiers'] as const;

  it('GET / usuário comum: nenhuma das 3 lojas em items nem em marketplaceAvailability', async () => {
    vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'listByTenant').mockResolvedValue([record('SHOPEE'), record('KABUM'), record('ALIEXPRESS')]);
    vi.spyOn(PrismaEntitlementReader.prototype, 'getBoolean').mockResolvedValue(true);
    vi.spyOn(PrismaEntitlementReader.prototype, 'getNumber').mockResolvedValue(null);
    const presets = vi.spyOn(PrismaPlanEntitlementPresetRepository.prototype, 'listByKeys').mockResolvedValue([]);
    vi.spyOn(PrismaMarketplaceRiskAcceptanceRepository.prototype, 'findCurrent').mockResolvedValue(null);

    const data = (await call('GET', '/')).json().data;
    expect(data.items.map((i: { provider: string }) => i.provider)).toEqual(['SHOPEE']);
    expect(Object.keys(data.marketplaceAvailability)).toEqual(['SHOPEE', 'MERCADO_LIVRE', 'AMAZON', 'SHEIN']);
    expect(presets).toHaveBeenCalledWith(['marketplace_shein_enabled']);

    const sa = (await call('GET', '/', undefined, saHeaders)).json().data;
    expect(sa.items.map((i: { provider: string }) => i.provider)).toEqual(['SHOPEE', 'KABUM', 'ALIEXPRESS']);
    expect(Object.keys(sa.marketplaceAvailability)).toHaveLength(7);
  });

  it('flag desligada pelo admin: usuário comum passa a ver a loja (só ela)', async () => {
    audience.mockResolvedValue({ marketplace_kabum_enabled: false });
    vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'listByTenant').mockResolvedValue([]);
    vi.spyOn(PrismaEntitlementReader.prototype, 'getBoolean').mockResolvedValue(true);
    vi.spyOn(PrismaEntitlementReader.prototype, 'getNumber').mockResolvedValue(null);
    vi.spyOn(PrismaPlanEntitlementPresetRepository.prototype, 'listByKeys').mockResolvedValue([]);
    vi.spyOn(PrismaMarketplaceRiskAcceptanceRepository.prototype, 'findCurrent').mockResolvedValue(null);
    const keys = Object.keys((await call('GET', '/')).json().data.marketplaceAvailability);
    expect(keys).toEqual(['SHOPEE', 'MERCADO_LIVRE', 'AMAZON', 'SHEIN', 'KABUM']);
  });

  it.each(PROVIDER_ROUTES)('%s /:provider%s — loja oculta responde igual a provider inexistente, sem tocar o banco', async (method, suffix, body) => {
    const spies = repoMethods.map((m) => vi.spyOn(PrismaAffiliateCredentialRepository.prototype, m));
    const unknown = await call(method, `/FOO${suffix}`, body);
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toEqual({
      success: false,
      error: { code: 'HTTP_ERROR', message: 'params/provider must be equal to one of the allowed values' },
    });
    for (const provider of HIDDEN) {
      const res = await call(method, `/${provider}${suffix}`, body);
      expect([res.statusCode, res.json()]).toEqual([400, unknown.json()]);
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('super admin salva AliExpress e lista; resposta nunca traz segredo nem App Key', async () => {
    vi.spyOn(SecretCipherFactory, 'get').mockReturnValue(new AesGcmSecretCipher(new Map([[1, Buffer.alloc(32, 7)]]), 1));
    vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'findByTenantAndProvider').mockResolvedValue(null);
    const upsert = vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'upsert')
      .mockResolvedValue({ ...record('ALIEXPRESS'), publicIdentifier: 'meu_tracking', hasSecret: true });
    const audit = vi.spyOn(PrismaAuditLogRepository.prototype, 'create').mockResolvedValue(undefined);
    const body = { publicIdentifier: 'meu_tracking', appKey: '512345', secret: 'AbCdEf0123456789AbCdEf0123456789' };

    const res = await call('PUT', '/ALIEXPRESS', body, saHeaders);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ provider: 'ALIEXPRESS', hasSecret: true });
    expect(res.body).not.toContain(body.secret);
    expect(res.body).not.toContain(body.appKey);
    expect(res.json().data).not.toHaveProperty('appKey');
    expect(res.json().data).not.toHaveProperty('secret');
    expect(upsert.mock.calls[0]![0].secret).toBeDefined();
    expect(JSON.stringify(audit.mock.calls)).not.toContain(body.secret);

    const missing = await call('PUT', '/ALIEXPRESS', { publicIdentifier: 'meu_tracking', secret: body.secret }, saHeaders);
    expect([missing.statusCode, missing.json().error.code]).toEqual([422, 'AFFILIATE_CREDENTIAL_INVALID']);
  });

  it('super admin: Magalu com URL da loja grava o slug', async () => {
    vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'findByTenantAndProvider').mockResolvedValue(null);
    const upsert = vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'upsert')
      .mockImplementation(async (i) => ({ ...record('MAGALU'), publicIdentifier: i.publicIdentifier }));
    vi.spyOn(PrismaAuditLogRepository.prototype, 'create').mockResolvedValue(undefined);
    const res = await call('PUT', '/MAGALU', { publicIdentifier: 'https://www.magazinevoce.com.br/minhaloja/' }, saHeaders);
    expect(res.statusCode).toBe(200);
    expect(upsert.mock.calls[0]![0].publicIdentifier).toBe('minhaloja');
  });

  it('appKey fora do limite do schema → 400; lojas antigas não leem a flag de audiência', async () => {
    const res = await call('PUT', '/ALIEXPRESS', { publicIdentifier: 'x', appKey: '1'.repeat(65) }, saHeaders);
    expect(res.statusCode).toBe(400);
    audience.mockClear();
    vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'delete').mockResolvedValue(true);
    vi.spyOn(PrismaAuditLogRepository.prototype, 'create').mockResolvedValue(undefined);
    expect((await call('DELETE', '/AMAZON')).statusCode).toBe(204);
    expect(audience).not.toHaveBeenCalled();
  });
});
