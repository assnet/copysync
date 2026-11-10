import { describe, expect, it, vi } from 'vitest';
import { SyncSheinSessionUseCase, type SyncSheinSessionDeps } from './SyncSheinSessionUseCase';
import { DisconnectMarketplaceSessionUseCase, GrantMarketplaceConsentUseCase } from './MarketplaceConsentUseCases';
import { MARKETPLACE_RISK_NOTICE_VERSION } from '../../../integrations/domain/services/marketplaceRiskNotice';
import { AffiliateCredentialNotFoundError } from '../../../../shared/errors/internal/AffiliateCredentialErrors';
import type { IMarketplaceRiskAcceptanceRepository } from '../../../integrations/domain/contracts/IMarketplaceRiskAcceptanceRepository';

const MEMBER = '4320454940';
const seg = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = (m: unknown) => `${seg({ a: 1 })}.${seg({ b: 7, t: 2, m, l: 1 })}.sig.x`;
const AT = tokenFor(Number(MEMBER));
const VERSION = MARKETPLACE_RISK_NOTICE_VERSION.SHEIN!;
const acceptance = { id: 'a1', tenantId: 't1', provider: 'SHEIN' as const, noticeVersion: VERSION, acceptedByUserId: 'u1', locale: 'pt-BR', acceptedAt: new Date() };

function riskRepo(accepted = true): IMarketplaceRiskAcceptanceRepository {
  return { findCurrent: vi.fn(async () => (accepted ? acceptance : null)), create: vi.fn(), listByTenant: vi.fn() };
}

function deps(over: Partial<{ consentAfter: boolean; otherConsent: boolean; plan: boolean; accepted: boolean; tenants: string[] }> = {}) {
  const d = {
    riskAcceptances: riskRepo(over.accepted ?? true),
    entitlements: { hasMarketplace: vi.fn(async () => over.plan ?? true) },
    profile: {
      execute: vi.fn(async () => ({
        user: { id: 'u1', name: 'U', email: 'u@x' }, mlTenantId: 't1',
        tenants: (over.tenants ?? ['t1']).map((id) => ({ id, name: id, slug: id, role: 'ADMIN', status: 'ACTIVE', permissions: [] })),
      })),
    },
    upsertSession: { execute: vi.fn(async (i: { sessionIdentifier?: string }) => ({ publicIdentifier: i.sessionIdentifier ?? null }) as never) },
    sessions: {
      hasConsent: vi.fn(async () => over.consentAfter ?? true),
      hasAnyConsentForTenant: vi.fn(async () => over.otherConsent ?? false),
    },
    deleteCredential: { execute: vi.fn(async () => undefined) },
  } satisfies SyncSheinSessionDeps;
  return d;
}

const input = (over: Partial<{ sheinConsent: boolean; AT: string; memberId: string }> = {}) => ({
  session: { sessionId: 's1', userId: 'u1', mlTenantId: 't1', sheinConsent: over.sheinConsent ?? true },
  cookies: { AT: over.AT ?? AT, memberId: over.memberId ?? MEMBER },
  capturedAt: '2026-11-10T12:00:00.000Z',
});

const run = (d: ReturnType<typeof deps>, i = input()) => new SyncSheinSessionUseCase(d).execute(i).catch((e: unknown) => e);

describe('SyncSheinSessionUseCase', () => {
  it('ok: upsert só com AT/memberId, ID vindo do token; resposta sem token', async () => {
    const d = deps();
    const res = await run(d);
    expect(res).toEqual({ affiliateId: MEMBER });
    expect(JSON.stringify(res)).not.toContain(AT);
    expect(d.upsertSession.execute).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1', userId: 'u1', provider: 'SHEIN', cookies: { AT, memberId: MEMBER }, sessionIdentifier: MEMBER,
    }));
    expect(d.sessions.hasConsent).toHaveBeenCalledWith('s1', 'SHEIN');
  });

  it.each([
    ['sem consentimento', () => deps(), input({ sheinConsent: false }), 403, 'SHEIN_CONSENT_REQUIRED'],
    ['sem aceite da versão vigente', () => deps({ accepted: false }), input(), 403, 'MARKETPLACE_RISK_NOT_ACCEPTED'],
    ['sem plano', () => deps({ plan: false }), input(), 403, 'PLAN_FEATURE_UNAVAILABLE'],
    ['sem vínculo ou tenant suspenso (fora do perfil)', () => deps({ tenants: ['outro'] }), input(), 403, 'EXTENSION_TENANT_FORBIDDEN'],
    ['m do token ≠ memberId', () => deps(), input({ memberId: '1111111111' }), 422, 'AFFILIATE_CREDENTIAL_INVALID'],
    ['token ilegível', () => deps(), input({ AT: 'lixo' }), 422, 'AFFILIATE_CREDENTIAL_INVALID'],
    ['m fora do formato', () => deps(), input({ AT: tokenFor('12ab'), memberId: '12ab' }), 422, 'AFFILIATE_CREDENTIAL_INVALID'],
  ])('%s → %i %s, nada gravado', async (_n, mk, i, status, code) => {
    const d = mk();
    const err = await run(d, i);
    expect(err).toMatchObject({ statusCode: status, code });
    expect(d.upsertSession.execute).not.toHaveBeenCalled();
    expect(JSON.stringify({ m: (err as Error).message, meta: (err as { meta?: unknown }).meta })).not.toContain(AT);
  });

  it('ordem: consentimento antes de aceite, aceite antes do plano', async () => {
    const d = deps({ accepted: false, plan: false });
    expect(await run(d, input({ sheinConsent: false }))).toMatchObject({ code: 'SHEIN_CONSENT_REQUIRED' });
    expect(await run(d)).toMatchObject({ code: 'MARKETPLACE_RISK_NOT_ACCEPTED' });
    expect(d.entitlements.hasMarketplace).not.toHaveBeenCalled();
  });

  it('consentimento revogado entre a checagem e o upsert: apaga a credencial e 403', async () => {
    const d = deps({ consentAfter: false });
    expect(await run(d)).toMatchObject({ statusCode: 403, code: 'SHEIN_CONSENT_REQUIRED' });
    expect(d.sessions.hasAnyConsentForTenant).toHaveBeenCalledWith('t1', 'SHEIN');
    expect(d.deleteCredential.execute).toHaveBeenCalledWith({ tenantId: 't1', userId: 'u1', provider: 'SHEIN' });
  });

  it('consentimento desta sessão revogado, mas outra instalação do tenant consente: mantém a credencial e 403', async () => {
    const d = deps({ consentAfter: false, otherConsent: true });
    expect(await run(d)).toMatchObject({ statusCode: 403, code: 'SHEIN_CONSENT_REQUIRED' });
    expect(d.sessions.hasAnyConsentForTenant).toHaveBeenCalledWith('t1', 'SHEIN');
    expect(d.deleteCredential.execute).not.toHaveBeenCalled();
  });

  it('consentimento mantido: não consulta as outras sessões', async () => {
    const d = deps();
    await run(d);
    expect(d.sessions.hasAnyConsentForTenant).not.toHaveBeenCalled();
  });

  it('revogado e credencial já apagada pelo "Desconectar": ainda 403', async () => {
    const d = deps({ consentAfter: false });
    d.deleteCredential.execute.mockRejectedValueOnce(new AffiliateCredentialNotFoundError('SHEIN'));
    expect(await run(d)).toMatchObject({ code: 'SHEIN_CONSENT_REQUIRED' });
  });
});

describe('GrantMarketplaceConsentUseCase (Shein)', () => {
  const target = { marketplace: 'SHEIN' as const, provider: 'SHEIN' as const };
  const make = (o: { plan?: boolean; accepted?: boolean; granted?: boolean } = {}) => {
    const sessions = { grantConsent: vi.fn(async () => o.granted ?? true) };
    const uc = new GrantMarketplaceConsentUseCase(target, sessions, { hasMarketplace: async () => o.plan ?? true }, riskRepo(o.accepted ?? true));
    return { sessions, run: () => uc.execute({ userId: 'u1', tenantId: 't1', installationId: 'i1' }).catch((e: unknown) => e) };
  };

  it('ok grava sheinConsentAt da instalação', async () => {
    const m = make();
    expect(await m.run()).toBeUndefined();
    expect(m.sessions.grantConsent).toHaveBeenCalledWith('SHEIN', 'u1', 'i1', 't1', expect.any(Date));
  });

  it.each([
    ['sem plano', { plan: false }, 403, 'PLAN_FEATURE_UNAVAILABLE'],
    ['sem aceite', { accepted: false }, 403, 'MARKETPLACE_RISK_NOT_ACCEPTED'],
  ])('%s → %i antes de gravar', async (_n, o, status, code) => {
    const m = make(o);
    expect(await m.run()).toMatchObject({ statusCode: status, code });
    expect(m.sessions.grantConsent).not.toHaveBeenCalled();
  });

  it('sem sessão da extensão → 404 SESSION_NOT_FOUND', async () => {
    expect(await make({ granted: false }).run()).toMatchObject({ statusCode: 404, code: 'SESSION_NOT_FOUND' });
  });
});

describe('DisconnectMarketplaceSessionUseCase (Shein)', () => {
  it('revoga o consentimento antes de apagar; sem credencial é idempotente', async () => {
    const order: string[] = [];
    const sessions = { revokeConsentForTenant: vi.fn(async () => { order.push('revoke'); return 1; }) };
    const del = { execute: vi.fn(async () => { order.push('delete'); throw new AffiliateCredentialNotFoundError('SHEIN'); }) };
    const uc = new DisconnectMarketplaceSessionUseCase({ marketplace: 'SHEIN', provider: 'SHEIN' }, sessions, del);
    await expect(uc.execute({ tenantId: 't1', userId: 'u1' })).resolves.toBeUndefined();
    expect(order).toEqual(['revoke', 'delete']);
    expect(sessions.revokeConsentForTenant).toHaveBeenCalledWith('SHEIN', 't1');
    expect(del.execute).toHaveBeenCalledWith({ tenantId: 't1', userId: 'u1', provider: 'SHEIN' });
  });
});
