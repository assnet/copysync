import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { UnauthorizedError } from '../../../../shared/errors/internal/AuthErrors';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { PrismaEntitlementReader } from '../../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { PrismaPlanEntitlementPresetRepository } from '../../../tenants/infrastructure/repositories/PrismaPlanEntitlementPresetRepository';
import { PrismaMarketplaceRiskAcceptanceRepository } from '../../infrastructure/repositories/PrismaMarketplaceRiskAcceptanceRepository';
import { PrismaAffiliateCredentialRepository } from '../../infrastructure/repositories/PrismaAffiliateCredentialRepository';
import { MARKETPLACE_RISK_NOTICE_VERSION } from '../../domain/services/marketplaceRiskNotice';
import { affiliateCredentialItemSchema } from '../schemas/affiliateCredential.schema';
import { affiliateCredentialRoutes } from './affiliateCredential.routes';

vi.mock('../../../../shared/database/prisma.client', () => ({
  prisma: {
    userTenant: { findUnique: async () => ({ role: 'ADMIN', tenant: { status: 'ACTIVE' } }) },
  },
}));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { headers: Record<string, unknown>; user?: unknown }) => {
    const auth = request.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) throw new UnauthorizedError('Invalid or expired access token');
    request.user = { userId: auth.slice(7), isSuperAdmin: false };
  },
}));

const VERSION = MARKETPLACE_RISK_NOTICE_VERSION.SHEIN!;
const AT = new Date('2026-11-10T12:00:00.000Z');
const headers = { authorization: 'Bearer u1', 'x-tenant-id': 't1' };
let app: FastifyInstance;

beforeEach(async () => {
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

const call = (method: 'GET' | 'PUT' | 'DELETE', path: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url: `/api/integrations/affiliate-credentials${path}`, headers, ...(payload && { payload }) });

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
    ]);
    vi.spyOn(PrismaMarketplaceRiskAcceptanceRepository.prototype, 'findCurrent').mockResolvedValue({
      id: 'a1', tenantId: 't1', provider: 'SHEIN', scope: 'AFFILIATE_LINK', noticeVersion: VERSION, acceptedByUserId: 'u1', locale: 'pt-BR', acceptedAt: AT,
    });

    const res = await call('GET', '/');
    expect(res.statusCode).toBe(200);
    expect(presets).toHaveBeenCalledWith(['marketplace_shein_enabled']);
    const open = { enabled: true, plans: [], riskNotice: null };
    expect(res.json().data).toEqual({
      items: [],
      marketplaceAvailability: {
        SHOPEE: open,
        MERCADO_LIVRE: open,
        AMAZON: open,
        SHEIN: { enabled: false, plans: ['COPYSYNC_MAX'], riskNotice: { version: VERSION, acceptedAt: AT.toISOString(), acceptedByMe: true } },
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
