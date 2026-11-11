import { describe, expect, it, vi } from 'vitest';
import { Tenant, type TenantProps } from '../../domain/entities/Tenant';
import type { ITenantRepository } from '../../domain/contracts/ITenantRepository';
import type { SubscriptionUsage } from '../../domain/services/subscriptionLimits';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { GetTenantSubscriptionUseCase } from './GetTenantSubscriptionUseCase';

const ch = (whatsapp: number, telegram: number) => ({ whatsapp, telegram });
const USAGE: SubscriptionUsage = {
  sessions: ch(2, 0),
  monitoredGroups: ch(5, 0),
  broadcastGroups: ch(8, 0),
  linkRotations: ch(1, 0),
  offerGenerationsToday: 12,
  aiRequestsToday: null,
  mercadoLivreAffiliateTags: 2,
};

function tenant(over: Partial<TenantProps> = {}): Tenant {
  return new Tenant({
    id: 't1', name: 'Loja', slug: 'loja', status: 'ACTIVE', billingCustomerId: null, planSlug: 'COPYSYNC_PRO',
    lastBillingEventSeq: null, suspendedAt: null, subscriptionExpiresAt: null, createdAt: new Date(0), updatedAt: new Date(0), ...over,
  });
}

function build(found: Tenant | null, values: Record<string, unknown> = {}, usage = USAGE) {
  const repo = { findById: vi.fn().mockResolvedValue(found) } as unknown as ITenantRepository;
  const readAll = vi.fn().mockResolvedValue(values);
  const read = vi.fn().mockResolvedValue(usage);
  return { uc: new GetTenantSubscriptionUseCase(repo, { readAll }, { read }), repo, readAll, read };
}

const item = (out: { limits: { key: string }[] }, key: string) => out.limits.find((l) => l.key === key);

describe('GetTenantSubscriptionUseCase', () => {
  it('tenant inexistente → NotFoundError 404', async () => {
    const { uc } = build(null);
    await expect(uc.execute('t1')).rejects.toBeInstanceOf(NotFoundError);
    await expect(uc.execute('t1')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('consulta as três fontes pelo tenantId', async () => {
    const { uc, repo, readAll, read } = build(tenant());
    await uc.execute('t1');
    expect(repo.findById).toHaveBeenCalledWith('t1');
    expect(readAll).toHaveBeenCalledWith('t1');
    expect(read).toHaveBeenCalledWith('t1');
  });

  it('plano nulo e sem entitlements: tudo ilimitado, sem vencimento', async () => {
    const { uc } = build(tenant({ planSlug: null }));
    const out = await uc.execute('t1');
    expect(out).toMatchObject({ tenantName: 'Loja', planSlug: null, status: 'ACTIVE', suspendedAt: null, expiresAt: null });
    expect(item(out, 'whatsapp_sessions')).toMatchObject({ used: 2, limit: null, enabled: true });
    expect(item(out, 'offer_generations_per_day')).toMatchObject({ kind: 'daily', used: 12, limit: null });
  });

  it('SUSPENDED devolve suspendedAt', async () => {
    const at = new Date('2026-11-01T10:00:00Z');
    const { uc } = build(tenant({ status: 'SUSPENDED', suspendedAt: at }));
    const out = await uc.execute('t1');
    expect(out.status).toBe('SUSPENDED');
    expect(out.suspendedAt).toBe(at);
  });

  it('repassa o vencimento quando o tenant tem', async () => {
    const exp = new Date('2026-12-01T00:00:00Z');
    const { uc } = build(tenant({ subscriptionExpiresAt: exp }));
    expect((await uc.execute('t1')).expiresAt).toBe(exp);
  });

  it('Telegram 0 = bloqueado; limite numérico e feature do snapshot', async () => {
    const { uc } = build(tenant(), { telegram_sessions: 0, whatsapp_sessions: '3', storefront_enabled: true });
    const out = await uc.execute('t1');
    expect(item(out, 'telegram_sessions')).toMatchObject({ channel: 'telegram', used: 0, limit: 0, enabled: false });
    expect(item(out, 'whatsapp_sessions')).toMatchObject({ channel: 'whatsapp', used: 2, limit: 3, enabled: true });
    expect(item(out, 'storefront_enabled')).toMatchObject({ kind: 'feature', used: null, enabled: true });
  });

  it('etiquetas do ML: uso × limite do plano; sem entitlement vale 1', async () => {
    const pro = await build(tenant(), { mercado_livre_affiliate_tags: 2 }).uc.execute('t1');
    expect(item(pro, 'mercado_livre_affiliate_tags')).toMatchObject({ kind: 'count', channel: null, used: 2, limit: 2 });
    const none = await build(tenant({ planSlug: null })).uc.execute('t1');
    expect(item(none, 'mercado_livre_affiliate_tags')).toMatchObject({ limit: 1 });
  });
});
