import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { UnauthorizedError } from '../../../../shared/errors/internal/AuthErrors';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { PrismaMarketplaceRiskAcceptanceRepository } from '../../infrastructure/repositories/PrismaMarketplaceRiskAcceptanceRepository';
import { affiliateCredentialItemSchema } from '../schemas/affiliateCredential.schema';
import { MARKETPLACE_RISK_NOTICE_VERSION, OFFER_HUNTER_RISK_NOTICE_VERSION } from '../../domain/services/marketplaceRiskNotice';
import { affiliateCredentialRoutes } from './affiliateCredential.routes';
import { marketplaceRiskAdminRoutes } from './marketplaceRiskAdmin.routes';

/* Fastify real + tenantHook/superAdminHook reais (membership no prisma falso); repositório espionado. */
const db = vi.hoisted(() => ({ members: new Map<string, { role: string; tenant: { status: string } }>() }));
vi.mock('../../../../shared/database/prisma.client', () => ({
  prisma: {
    // UnitOfWork: o `tx` não é usado (repositórios espionados no protótipo).
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    tenant: { findUnique: async () => ({ id: 't1', status: 'ACTIVE' }) },
    userTenant: {
      findUnique: async ({ where }: { where: { userId_tenantId: { userId: string; tenantId: string } } }) =>
        db.members.get(`${where.userId_tenantId.userId}:${where.userId_tenantId.tenantId}`) ?? null,
    },
  },
}));
// `Bearer sa:<id>` = super admin; `Bearer <id>` = usuário comum.
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { headers: Record<string, unknown>; user?: unknown }) => {
    const auth = request.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) throw new UnauthorizedError('Invalid or expired access token');
    const token = auth.slice(7);
    request.user = token.startsWith('sa:') ? { userId: token.slice(3), isSuperAdmin: true } : { userId: token, isSuperAdmin: false };
  },
}));

const VERSION = MARKETPLACE_RISK_NOTICE_VERSION.SHEIN!;
const HUNTER_VERSION = OFFER_HUNTER_RISK_NOTICE_VERSION.SHEIN!;
const AT = new Date('2026-11-10T12:00:00.000Z');
const row = { id: 'a1', tenantId: 't1', provider: 'SHEIN' as const, scope: 'AFFILIATE_LINK' as const, noticeVersion: VERSION, acceptedByUserId: 'u1', locale: 'pt-BR', acceptedAt: AT };

let app: FastifyInstance;

beforeEach(async () => {
  db.members.clear();
  app = Fastify();
  app.setErrorHandler(errorHandler);
  app.addSchema({
    $id: 'ErrorResponse',
    type: 'object',
    properties: { success: { type: 'boolean' }, error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } },
  });
  app.addSchema(affiliateCredentialItemSchema);
  await app.register(affiliateCredentialRoutes, { prefix: '/api/integrations/affiliate-credentials' });
  await app.register(marketplaceRiskAdminRoutes, { prefix: '/api/admin/tenants' });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

const accept = (token: string, body: unknown, provider = 'SHEIN') =>
  app.inject({
    method: 'POST',
    url: `/api/integrations/affiliate-credentials/${provider}/risk-acceptance`,
    headers: { authorization: `Bearer ${token}`, 'x-tenant-id': 't1' },
    payload: body as Record<string, unknown>,
  });

describe('POST /:provider/risk-acceptance', () => {
  it('admin: 200 com hora e versão; grava com dados do tenantContext e audita', async () => {
    db.members.set('u1:t1', { role: 'ADMIN', tenant: { status: 'ACTIVE' } });
    const create = vi.spyOn(PrismaMarketplaceRiskAcceptanceRepository.prototype, 'create').mockResolvedValue({ acceptance: row, created: true });
    const audit = vi.spyOn(PrismaAuditLogRepository.prototype, 'create').mockResolvedValue(undefined);
    const res = await accept('u1', { noticeVersion: VERSION, locale: 'pt-BR' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { acceptedAt: AT.toISOString(), noticeVersion: VERSION, scope: 'AFFILIATE_LINK' } });
    expect(create).toHaveBeenCalledWith({ tenantId: 't1', provider: 'SHEIN', scope: 'AFFILIATE_LINK', noticeVersion: VERSION, acceptedByUserId: 'u1', locale: 'pt-BR' });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'MARKETPLACE_RISK_ACCEPTED', tenantId: 't1', userId: 'u1' }));
  });

  it('repetido: devolve o existente sem auditar', async () => {
    db.members.set('u1:t1', { role: 'ADMIN', tenant: { status: 'ACTIVE' } });
    vi.spyOn(PrismaMarketplaceRiskAcceptanceRepository.prototype, 'create').mockResolvedValue({ acceptance: row, created: false });
    const audit = vi.spyOn(PrismaAuditLogRepository.prototype, 'create').mockResolvedValue(undefined);
    expect((await accept('u1', { noticeVersion: VERSION, locale: 'en' })).statusCode).toBe(200);
    expect(audit).not.toHaveBeenCalled();
  });

  it.each([
    ['operador', 'u2', () => db.members.set('u2:t1', { role: 'OPERATOR', tenant: { status: 'ACTIVE' } }), 403, 'FORBIDDEN'],
    ['super admin em tenant alheio', 'sa:root', () => undefined, 403, 'FORBIDDEN'],
  ])('%s → %i', async (_n, token, setup, status, code) => {
    setup();
    const create = vi.spyOn(PrismaMarketplaceRiskAcceptanceRepository.prototype, 'create');
    const res = await accept(token, { noticeVersion: VERSION, locale: 'pt-BR' });
    expect(res.statusCode).toBe(status);
    expect(res.json().error.code).toBe(code);
    expect(create).not.toHaveBeenCalled();
  });

  it('versão antiga → 409; provider sem aviso → 422; corpo inválido → 400', async () => {
    db.members.set('u1:t1', { role: 'ADMIN', tenant: { status: 'ACTIVE' } });
    const create = vi.spyOn(PrismaMarketplaceRiskAcceptanceRepository.prototype, 'create');
    const old = await accept('u1', { noticeVersion: '2025-01-01', locale: 'pt-BR' });
    expect([old.statusCode, old.json().error.code]).toEqual([409, 'MARKETPLACE_RISK_NOTICE_OUTDATED']);
    const shopee = await accept('u1', { noticeVersion: VERSION, locale: 'pt-BR' }, 'SHOPEE');
    expect([shopee.statusCode, shopee.json().error.code]).toEqual([422, 'AFFILIATE_CREDENTIAL_INVALID']);
    expect((await accept('u1', { noticeVersion: VERSION, locale: 'pt_BR' })).statusCode).toBe(400);
    expect((await accept('u1', { noticeVersion: VERSION })).statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('scope OFFER_HUNTER: grava no escopo do caçador com a versão dele', async () => {
    db.members.set('u1:t1', { role: 'ADMIN', tenant: { status: 'ACTIVE' } });
    const hunterRow = { ...row, scope: 'OFFER_HUNTER' as const, noticeVersion: HUNTER_VERSION };
    const create = vi.spyOn(PrismaMarketplaceRiskAcceptanceRepository.prototype, 'create').mockResolvedValue({ acceptance: hunterRow, created: true });
    vi.spyOn(PrismaAuditLogRepository.prototype, 'create').mockResolvedValue(undefined);
    const res = await accept('u1', { noticeVersion: HUNTER_VERSION, locale: 'pt-BR', scope: 'OFFER_HUNTER' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ acceptedAt: AT.toISOString(), noticeVersion: HUNTER_VERSION, scope: 'OFFER_HUNTER' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ scope: 'OFFER_HUNTER', noticeVersion: HUNTER_VERSION }));
  });

  it('scope inválido → 400; OFFER_HUNTER fora da SHEIN → 422; super admin → 403', async () => {
    db.members.set('u1:t1', { role: 'ADMIN', tenant: { status: 'ACTIVE' } });
    const create = vi.spyOn(PrismaMarketplaceRiskAcceptanceRepository.prototype, 'create');
    expect((await accept('u1', { noticeVersion: HUNTER_VERSION, locale: 'pt-BR', scope: 'OTHER' })).statusCode).toBe(400);
    const shopee = await accept('u1', { noticeVersion: HUNTER_VERSION, locale: 'pt-BR', scope: 'OFFER_HUNTER' }, 'SHOPEE');
    expect([shopee.statusCode, shopee.json().error.code]).toEqual([422, 'AFFILIATE_CREDENTIAL_INVALID']);
    const sa = await accept('sa:root', { noticeVersion: HUNTER_VERSION, locale: 'pt-BR', scope: 'OFFER_HUNTER' });
    expect(sa.statusCode).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('GET /admin/tenants/:tenantId/marketplace-risk-acceptances', () => {
  const list = (token?: string) =>
    app.inject({
      method: 'GET',
      url: '/api/admin/tenants/t1/marketplace-risk-acceptances',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('super admin lista os aceites do tenant', async () => {
    const spy = vi.spyOn(PrismaMarketplaceRiskAcceptanceRepository.prototype, 'listByTenant').mockResolvedValue([row]);
    const res = await list('sa:root');
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith('t1');
    expect(res.json()).toEqual({
      success: true,
      data: [{ provider: 'SHEIN', scope: 'AFFILIATE_LINK', noticeVersion: VERSION, acceptedByUserId: 'u1', locale: 'pt-BR', acceptedAt: AT.toISOString() }],
    });
  });

  it('não super admin → 401; sem token → 401', async () => {
    const spy = vi.spyOn(PrismaMarketplaceRiskAcceptanceRepository.prototype, 'listByTenant');
    expect((await list('u1')).statusCode).toBe(401);
    expect((await list()).statusCode).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });
});
