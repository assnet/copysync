import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { UnauthorizedError } from '../../../../shared/errors/internal/AuthErrors';
import { AesGcmSecretCipher } from '../../../../shared/security/AesGcmSecretCipher';
import { SecretCipherFactory } from '../../../../shared/security/SecretCipherFactory';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { PrismaEntitlementReader } from '../../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { PrismaMarketplaceRiskAcceptanceRepository } from '../../../integrations/infrastructure/repositories/PrismaMarketplaceRiskAcceptanceRepository';
import { PrismaAffiliateCredentialRepository } from '../../../integrations/infrastructure/repositories/PrismaAffiliateCredentialRepository';
import { MARKETPLACE_RISK_NOTICE_VERSION } from '../../../integrations/domain/services/marketplaceRiskNotice';
import type { AffiliateCredentialRecord, UpsertAffiliateSessionRecord } from '../../../integrations/domain/contracts/AffiliateCredentialRecords';
import { PrismaExtensionSessionRepository } from '../../infrastructure/repositories/PrismaExtensionSessionRepository';
import type { ExtensionSession } from '../../domain/entities/ExtensionSession';
import { extensionRoutes } from './extension.routes';

/*
 * Fastify real com os hooks reais da extensão (guard + auth) e o tenantHook real; repositórios Prisma
 * espionados no protótipo. Prisma falso só para o perfil (user/userTenant) e o tenantHook.
 */
const db = vi.hoisted(() => ({
  memberships: [] as { tenantId: string; role: string; tenant: { name: string; slug: string; status: string } }[],
}));
vi.mock('../../../../shared/database/prisma.client', () => ({
  prisma: {
    user: { findUniqueOrThrow: async () => ({ id: 'u1', name: 'Ana', email: 'ana@x.dev' }) },
    userTenant: {
      findMany: async () => db.memberships,
      findUnique: async ({ where }: { where: { userId_tenantId: { tenantId: string } } }) => {
        const m = db.memberships.find((x) => x.tenantId === where.userId_tenantId.tenantId);
        return m ? { role: m.role, tenant: { status: m.tenant.status } } : null;
      },
    },
  },
}));
// Logger gravando tudo (inclusive `child`): o teste confere que o token nunca é logado.
const logged = vi.hoisted(() => [] as unknown[]);
vi.mock('../../../../shared/logger/logger', () => {
  const rec = (...args: unknown[]) => { logged.push(args); };
  const fake: Record<string, unknown> = { trace: rec, debug: rec, info: rec, warn: rec, error: rec, fatal: rec };
  fake.child = () => fake;
  return { logger: fake };
});
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { headers: Record<string, unknown>; user?: unknown }) => {
    const auth = request.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) throw new UnauthorizedError('Invalid or expired access token');
    request.user = { userId: auth.slice(7), isSuperAdmin: false };
  },
}));

const MEMBER = '4320454940';
const seg = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = (m: number) => `${seg({ a: 1 })}.${seg({ b: 7, g: 3, r: 'x', t: 2, m, l: 9 })}.assinatura.fim`;
const AT = tokenFor(Number(MEMBER));
const VERSION = MARKETPLACE_RISK_NOTICE_VERSION.SHEIN!;
const INSTALL = 'e3814c80-a096-4fe5-8039-0612dfaeb2af';
const cipher = new AesGcmSecretCipher(new Map([[1, Buffer.alloc(32, 7)]]), 1);
const EXT_HEADERS = { 'x-client': 'extension', 'x-installation-id': INSTALL, cookie: 'ext_session=raw-token' };

let app: FastifyInstance;
let state: {
  session: ExtensionSession;
  plan: boolean;
  accepted: boolean;
  consentNow: boolean;
  credentials: Map<string, AffiliateCredentialRecord>;
};

function extSession(over: Partial<ExtensionSession> = {}): ExtensionSession {
  const soon = new Date(Date.now() + 24 * 3600_000);
  return {
    id: 's1', tokenHash: 'h', prevTokenHash: null, prevValidUntil: null, userId: 'u1', installationId: INSTALL,
    mlTenantId: 't1', extVersion: '3.4.0', mlConsentAt: null, sheinConsentAt: new Date(), lastSeenAt: new Date(),
    expiresAt: soon, absoluteExpiresAt: soon, revokedAt: null, createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

function credentialFrom(i: UpsertAffiliateSessionRecord, prev?: AffiliateCredentialRecord): AffiliateCredentialRecord {
  const now = new Date();
  return {
    id: 'c1', tenantId: i.tenantId, provider: i.provider,
    publicIdentifier: i.publicIdentifierOverride ?? prev?.publicIdentifier ?? i.publicIdentifierIfEmpty ?? null,
    hasSecret: false, hasSession: true, sessionSyncedAt: i.syncedAt, sessionInvalidAt: null, sessionAccountHash: null,
    sessionAccountKeyVersion: null, status: 'ACTIVE', lastValidatedAt: null,
    rejectedAt: i.rejectWith?.at ?? (i.clearRejection ? null : prev?.rejectedAt ?? null),
    rejectedCode: i.rejectWith?.code ?? (i.clearRejection ? null : prev?.rejectedCode ?? null),
    createdAt: now, updatedAt: now, secret: null, session: i.session,
  };
}

beforeEach(async () => {
  db.memberships = [{ tenantId: 't1', role: 'ADMIN', tenant: { name: 'Loja', slug: 'loja', status: 'ACTIVE' } }];
  state = { session: extSession(), plan: true, accepted: true, consentNow: true, credentials: new Map() };

  vi.spyOn(SecretCipherFactory, 'get').mockReturnValue(cipher);
  vi.spyOn(PrismaAuditLogRepository.prototype, 'create').mockResolvedValue(undefined);
  vi.spyOn(PrismaExtensionSessionRepository.prototype, 'findByTokenHash').mockImplementation(async () => state.session);
  vi.spyOn(PrismaExtensionSessionRepository.prototype, 'hasConsent').mockImplementation(async () => state.consentNow);
  vi.spyOn(PrismaEntitlementReader.prototype, 'getBoolean').mockImplementation(async (_t, key) =>
    key === 'marketplace_shein_enabled' ? state.plan : true);
  vi.spyOn(PrismaMarketplaceRiskAcceptanceRepository.prototype, 'findCurrent').mockImplementation(async () =>
    state.accepted
      ? { id: 'a1', tenantId: 't1', provider: 'SHEIN', noticeVersion: VERSION, acceptedByUserId: 'u1', locale: 'pt-BR', acceptedAt: new Date() }
      : null);
  vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'findByTenantAndProvider').mockImplementation(async (_t, p) =>
    state.credentials.get(p) ?? null);
  vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'upsertSession').mockImplementation(async (i) => {
    const rec = credentialFrom(i, state.credentials.get(i.provider));
    state.credentials.set(i.provider, rec);
    return rec;
  });
  vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'delete').mockImplementation(async (_t, p) =>
    state.credentials.delete(p));

  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(extensionRoutes, { prefix: '/api/extension' });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

const sync = (cookies: Record<string, unknown> = { AT, memberId: MEMBER }, headers: Record<string, string> = EXT_HEADERS) =>
  app.inject({
    method: 'PUT',
    url: '/api/extension/marketplaces/shein/session',
    headers,
    payload: { cookies, capturedAt: '2026-11-10T12:00:00.000Z' },
  });

const storedCookies = () => {
  const rec = state.credentials.get('SHEIN')!;
  return JSON.parse(cipher.decrypt(rec.session!, 't1:SHEIN:session')).cookies as Record<string, string>;
};

describe('PUT /marketplaces/shein/session', () => {
  it('ok: grava cifrado e responde só o ID; token fora da resposta e do log', async () => {
    logged.length = 0;
    const res = await sync({ AT: 'nao.e.token', memberId: MEMBER });
    expect(res.statusCode).toBe(422);
    const ok = await sync();
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ success: true, data: { affiliateId: MEMBER } });
    expect(ok.body).not.toContain(AT);
    expect(JSON.stringify(logged)).not.toContain(AT);
    expect(JSON.stringify(logged)).not.toContain('nao.e.token');
    const rec = state.credentials.get('SHEIN')!;
    expect(rec.session!.ciphertext.toString('utf8')).not.toContain(AT);
    expect(storedCookies()).toEqual({ AT, memberId: MEMBER });
    const audit = vi.mocked(PrismaAuditLogRepository.prototype.create);
    expect(JSON.stringify(audit.mock.calls)).not.toContain(AT);
  });

  it('cookie extra é removido pelo schema: 200 e credencial só com AT/memberId', async () => {
    const res = await sync({ AT, memberId: MEMBER, sessionID: 'x', token: 'y' });
    expect(res.statusCode).toBe(200);
    expect(storedCookies()).toEqual({ AT, memberId: MEMBER });
  });

  it.each([[{ memberId: MEMBER }], [{ AT }], [{ AT: '', memberId: MEMBER }]])('sem AT ou memberId → 400 (%j)', async (cookies) => {
    expect((await sync(cookies)).statusCode).toBe(400);
    expect(state.credentials.size).toBe(0);
  });

  it('sem os headers da extensão → recusa (guard)', async () => {
    expect((await sync(undefined, { cookie: 'ext_session=raw-token' })).statusCode).toBe(403);
    expect((await sync(undefined, { ...EXT_HEADERS, 'x-installation-id': 'x' })).statusCode).toBe(400);
    expect(state.credentials.size).toBe(0);
  });

  it.each([
    ['sem consentimento', () => { state.session = extSession({ sheinConsentAt: null }); }, 'SHEIN_CONSENT_REQUIRED'],
    ['sem aceite da versão vigente', () => { state.accepted = false; }, 'MARKETPLACE_RISK_NOT_ACCEPTED'],
    ['sem plano', () => { state.plan = false; }, 'PLAN_FEATURE_UNAVAILABLE'],
    ['usuário sem vínculo', () => { db.memberships = []; }, 'EXTENSION_TENANT_FORBIDDEN'],
    ['tenant suspenso', () => { db.memberships[0]!.tenant.status = 'SUSPENDED'; }, 'EXTENSION_TENANT_FORBIDDEN'],
  ])('%s → 403', async (_n, setup, code) => {
    setup();
    const res = await sync();
    expect([res.statusCode, res.json().error.code]).toEqual([403, code]);
    expect(state.credentials.size).toBe(0);
  });

  it('m do token ≠ memberId, ou token ilegível → 422', async () => {
    expect((await sync({ AT, memberId: '1111111111' })).statusCode).toBe(422);
    const bad = await sync({ AT: 'nao.e.token', memberId: MEMBER });
    expect([bad.statusCode, bad.json().error.code]).toEqual([422, 'AFFILIATE_CREDENTIAL_INVALID']);
    expect(bad.body).not.toContain('nao.e.token');
    expect(state.credentials.size).toBe(0);
  });

  it('consentimento revogado entre a checagem e o upsert → credencial apagada e 403', async () => {
    state.consentNow = false;
    const res = await sync();
    expect([res.statusCode, res.json().error.code]).toEqual([403, 'SHEIN_CONSENT_REQUIRED']);
    expect(state.credentials.has('SHEIN')).toBe(false);
  });

  it('troca de conta substitui o ID', async () => {
    await sync();
    const other = '9876543210';
    const res = await sync({ AT: tokenFor(Number(other)), memberId: other });
    expect(res.json().data).toEqual({ affiliateId: other });
    expect(state.credentials.get('SHEIN')!.publicIdentifier).toBe(other);
  });

  it('mesmo AT em sync repetido: não zera a recusa nem audita de novo', async () => {
    await sync();
    const rec = state.credentials.get('SHEIN')!;
    state.credentials.set('SHEIN', { ...rec, rejectedAt: new Date('2026-11-01T00:00:00Z'), rejectedCode: 'AFFILIATE_CREDENTIAL_REJECTED' });
    const audit = vi.mocked(PrismaAuditLogRepository.prototype.create);
    audit.mockClear();
    expect((await sync()).statusCode).toBe(200);
    expect(state.credentials.get('SHEIN')!.rejectedCode).toBe('AFFILIATE_CREDENTIAL_REJECTED');
    expect(audit).not.toHaveBeenCalled();
  });

  it('re-vínculo a outro tenant (sheinConsentAt zerado) → sync volta a dar 403', async () => {
    state.session = extSession({ mlTenantId: 't2', sheinConsentAt: null });
    expect((await sync()).json().error.code).toBe('SHEIN_CONSENT_REQUIRED');
  });
});

describe('POST /marketplaces/shein/consent e DELETE /marketplaces/shein/session (painel)', () => {
  const bearer = { authorization: 'Bearer u1', 'x-tenant-id': 't1' };
  const consent = () =>
    app.inject({ method: 'POST', url: '/api/extension/marketplaces/shein/consent', headers: bearer, payload: { installationId: INSTALL } });

  it('ok grava o consentimento Shein da instalação', async () => {
    const grant = vi.spyOn(PrismaExtensionSessionRepository.prototype, 'grantConsent').mockResolvedValue(true);
    const res = await consent();
    expect(res.statusCode).toBe(200);
    expect(grant).toHaveBeenCalledWith('SHEIN', 'u1', INSTALL, 't1', expect.any(Date));
  });

  it.each([
    ['sem plano', () => { state.plan = false; }, 'PLAN_FEATURE_UNAVAILABLE'],
    ['sem aceite', () => { state.accepted = false; }, 'MARKETPLACE_RISK_NOT_ACCEPTED'],
  ])('%s → 403 sem gravar', async (_n, setup, code) => {
    setup();
    const grant = vi.spyOn(PrismaExtensionSessionRepository.prototype, 'grantConsent');
    const res = await consent();
    expect([res.statusCode, res.json().error.code]).toEqual([403, code]);
    expect(grant).not.toHaveBeenCalled();
  });

  it('sem sessão da extensão → 404 SESSION_NOT_FOUND', async () => {
    vi.spyOn(PrismaExtensionSessionRepository.prototype, 'grantConsent').mockResolvedValue(false);
    const res = await consent();
    expect([res.statusCode, res.json().error.code]).toEqual([404, 'SESSION_NOT_FOUND']);
  });

  it('DELETE revoga e apaga a credencial; sem credencial também 204', async () => {
    const revoke = vi.spyOn(PrismaExtensionSessionRepository.prototype, 'revokeConsentForTenant').mockResolvedValue(1);
    await sync();
    const del = () => app.inject({ method: 'DELETE', url: '/api/extension/marketplaces/shein/session', headers: bearer });
    expect((await del()).statusCode).toBe(204);
    expect(revoke).toHaveBeenCalledWith('SHEIN', 't1');
    expect(state.credentials.has('SHEIN')).toBe(false);
    expect((await del()).statusCode).toBe(204);
  });
});

describe('ML inalterado', () => {
  it('PUT ml/session segue exigindo ssid e o consentimento ML', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/extension/marketplaces/ml/session', headers: EXT_HEADERS,
      payload: { cookies: { ssid: 'x' }, capturedAt: 'now' },
    });
    expect([res.statusCode, res.json().error.code]).toEqual([403, 'ML_CONSENT_REQUIRED']);
  });
});
