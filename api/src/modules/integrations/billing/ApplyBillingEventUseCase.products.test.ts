import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

/** Banco em memória com `tenant_products` (webhook por produto, docs/acesso-por-produto.md). */
const db = vi.hoisted(() => {
  type Tenant = {
    id: string; status: string; lastBillingEventSeq: bigint | null; planSlug: string | null;
    suspendedAt: Date | null; subscriptionExpiresAt: Date | null; adminBlockedAt: Date | null;
  };
  type Row = {
    id: string; tenantId: string; product: string; status: string; planSlug: string | null; expiresAt: Date | null;
    source: string; inactiveSince: Date | null; createdAt: Date; updatedAt: Date;
  };
  const PRESETS: Record<string, Record<string, unknown>> = {
    COPYSYNC_PRO: { whatsapp_sessions: 2, telegram_sessions: 1, offer_generations_per_day: 20 },
    COPYSYNC_MAX: { whatsapp_sessions: 5, telegram_sessions: 2, offer_generations_per_day: null },
    SAVER_PRO: { whatsapp_sessions: 3, saver_contacts: 1000 },
    SAVER_LITE: { whatsapp_sessions: 1, saver_contacts: 100 },
  };
  const state = {
    tenant: null as Tenant | null,
    receipts: new Map<string, { outcome: string }>(),
    entitlements: new Map<string, unknown>(),
    products: new Map<string, Row>(),
  };
  const key = (tenantId: string, product: string) => `${tenantId}:${product}`;
  const rowsOf = (tenantId: string) => [...state.products.values()].filter((r) => r.tenantId === tenantId);
  const client = {
    $queryRaw: async () => {
      const t = state.tenant;
      if (!t) return [];
      const rows = rowsOf(t.id);
      return [{
        id: t.id, status: t.status, lastBillingEventSeq: t.lastBillingEventSeq, adminBlockedAt: t.adminBlockedAt,
        hasProductRows: rows.length > 0, hasAffiliatesRow: rows.some((r) => r.product === 'AFFILIATES'),
      }];
    },
    user: { findUnique: async () => null },
    userTenant: { findMany: async () => [], findFirst: async () => null },
    auditLog: { create: async () => ({}) },
    billingEventReceipt: {
      findUnique: async ({ where }: { where: { eventId: string } }) => state.receipts.get(where.eventId) ?? null,
      create: async ({ data }: { data: { eventId: string; outcome: string } }) => { state.receipts.set(data.eventId, { outcome: data.outcome }); return {}; },
    },
    tenant: {
      findUnique: async () => (state.tenant ? { ...state.tenant } : null),
      update: async ({ data }: { data: Partial<Tenant> }) => { Object.assign(state.tenant!, data); return {}; },
      updateMany: async ({ data }: { data: { lastBillingEventSeq: bigint } }) => {
        const t = state.tenant!;
        if (t.lastBillingEventSeq === null || t.lastBillingEventSeq < data.lastBillingEventSeq) t.lastBillingEventSeq = data.lastBillingEventSeq;
        return { count: 1 };
      },
    },
    planEntitlementPreset: {
      findMany: async ({ where }: { where: { planSlug: string; key?: { in: string[] } } }) =>
        Object.entries(PRESETS[where.planSlug] ?? {})
          .filter(([k]) => !where.key || where.key.in.includes(k))
          .map(([k, value]) => ({ key: k, value })),
    },
    tenantEntitlement: {
      upsert: async ({ create, update }: { create: { key: string; value: unknown }; update: { value: unknown } }) => {
        state.entitlements.set(create.key, state.entitlements.has(create.key) ? update.value : create.value);
        return {};
      },
    },
    tenantProduct: {
      findUnique: async ({ where }: { where: { tenantId_product: { tenantId: string; product: string } } }) =>
        state.products.get(key(where.tenantId_product.tenantId, where.tenantId_product.product)) ?? null,
      findMany: async ({ where }: { where: { tenantId: string } }) => rowsOf(where.tenantId),
      upsert: async ({ where, create, update }: { where: { tenantId_product: { tenantId: string; product: string } }; create: Partial<Row>; update: Partial<Row> }) => {
        const k = key(where.tenantId_product.tenantId, where.tenantId_product.product);
        const cur = state.products.get(k);
        const now = new Date();
        const next = cur ? { ...cur, ...update, updatedAt: now } : { id: k, inactiveSince: null, createdAt: now, updatedAt: now, ...create } as Row;
        state.products.set(k, next);
        return next;
      },
      update: async ({ where, data }: { where: { tenantId_product: { tenantId: string; product: string } }; data: Partial<Row> }) => {
        const k = key(where.tenantId_product.tenantId, where.tenantId_product.product);
        const next = { ...state.products.get(k)!, ...data };
        state.products.set(k, next);
        return next;
      },
    },
  };
  const prisma = { ...client, $transaction: async (fn: (t: typeof client) => Promise<unknown>) => fn(client) };
  const addRow = (product: string, status: string, o: Partial<Row> = {}) => {
    const now = new Date();
    state.products.set(key('tenant-1', product), {
      id: product, tenantId: 'tenant-1', product, status, planSlug: null, expiresAt: null, source: 'BILLING',
      inactiveSince: status === 'ACTIVE' ? null : now, createdAt: now, updatedAt: now, ...o,
    });
  };
  return { state, prisma, addRow };
});

const invalidate = vi.hoisted(() => vi.fn());
vi.mock('../../../shared/database/prisma.client', () => ({ prisma: db.prisma }));
vi.mock('../../../shared/events/InternalEventBus', () => ({ internalEventBus: { emit: vi.fn() } }));
vi.mock('./applyPlanSideEffects', () => ({ applyPlanSideEffects: vi.fn(async () => ({})) }));
vi.mock('../../tenants/infrastructure/access/CachedProductAccessReader', () => ({
  CachedProductAccessReader: class { invalidate = invalidate; },
}));

import { ApplyBillingEventUseCase, type ApplyBillingEventInput } from './ApplyBillingEventUseCase';

const NOW = Date.now();
const iso = (days: number) => new Date(NOW + days * 86_400_000).toISOString();
const hubSub = (o: Record<string, unknown> = {}) => ({ id: 's-aff', planSlug: 'copysync-pro-mensal', billingStatus: 'ACTIVE', expiresAt: iso(10), deletedAt: null, ...o });
const saverSub = (o: Record<string, unknown> = {}) => hubSub({ id: 's-saver', planSlug: 'copysync-saver-pro-mensal', ...o });
const hubOk = (subscriptions: unknown[]) => ({ ok: true, snapshot: { externalUserId: 'c1', subscriptions, lastSeq: 11n } });
const hub = { fetchByCustomer: vi.fn() };
const provisioner = { execute: vi.fn() };

function makeTenant(o: Partial<NonNullable<typeof db.state.tenant>> = {}) {
  db.state.tenant = {
    id: 'tenant-1', status: 'ACTIVE', lastBillingEventSeq: 10n, planSlug: 'COPYSYNC_PRO', suspendedAt: null,
    subscriptionExpiresAt: new Date('2027-01-01T00:00:00Z'), adminBlockedAt: null, ...o,
  };
}
const ev = (eventType: string, payload: ApplyBillingEventInput['payload'] = {}, o: Partial<ApplyBillingEventInput> = {}): ApplyBillingEventInput => ({
  eventId: `ev-${eventType}-${Math.random()}`, billingCustomerId: 'c1', eventType, seq: 11n,
  payload: { email: 'ana@x.com', name: 'Ana', planSlug: 'copysync-saver-pro-mensal', ...payload }, ...o,
});
const run = (input: ApplyBillingEventInput) => new ApplyBillingEventUseCase(provisioner, hub).execute(input);
const row = (product: string) => db.state.products.get(`tenant-1:${product}`);

beforeEach(() => {
  db.state.tenant = null;
  db.state.receipts.clear();
  db.state.entitlements.clear();
  db.state.products.clear();
  invalidate.mockReset();
  hub.fetchByCustomer.mockReset();
  provisioner.execute.mockReset();
});

describe('ApplyBillingEventUseCase por produto', () => {
  it('cliente novo Saver: provisiona com produto inicial, linha ativa e preset Saver', async () => {
    provisioner.execute.mockImplementation(async () => {
      makeTenant({ planSlug: null, lastBillingEventSeq: null, subscriptionExpiresAt: null });
      db.addRow('SAVER', 'ACTIVE', { planSlug: 'SAVER_PRO' });
      db.addRow('AFFILIATES', 'INACTIVE');
      return { tenantId: 'tenant-1' };
    });
    const out = await run(ev('subscription.activated', { expiresAt: iso(30) }));
    expect(provisioner.execute.mock.calls[0]![0]).toMatchObject({ planSlug: undefined, initialProducts: [{ product: 'SAVER', planSlug: 'SAVER_PRO' }] });
    expect(out).toEqual({ outcome: 'APPLIED', tenantId: 'tenant-1' });
    expect(row('SAVER')).toMatchObject({ status: 'ACTIVE', planSlug: 'SAVER_PRO', expiresAt: new Date(iso(30)) });
    expect(db.state.tenant).toMatchObject({ planSlug: null, subscriptionExpiresAt: null });
    expect(db.state.entitlements.get('saver_contacts')).toBe(1000);
    expect(db.state.entitlements.get('whatsapp_sessions')).toBe(3);
    expect(invalidate).toHaveBeenCalledWith('tenant-1');
  });

  it('Saver em tenant ativo não toca plano, vencimento nem entitlements de Afiliados; compartilhadas pela união', async () => {
    makeTenant();
    db.state.entitlements.set('offer_generations_per_day', 20);
    const before = { ...db.state.tenant! };
    expect(await run(ev('subscription.renewed', { expiresAt: iso(30) }))).toMatchObject({ outcome: 'APPLIED' });
    expect(hub.fetchByCustomer).not.toHaveBeenCalled();
    expect(db.state.tenant).toMatchObject({ planSlug: before.planSlug, subscriptionExpiresAt: before.subscriptionExpiresAt, status: 'ACTIVE' });
    expect(row('SAVER')).toMatchObject({ status: 'ACTIVE', planSlug: 'SAVER_PRO' });
    expect(row('AFFILIATES')).toBeUndefined();
    expect(db.state.entitlements.get('offer_generations_per_day')).toBe(20);
    expect(db.state.entitlements.get('whatsapp_sessions')).toBe(3); // max(PRO 2, SAVER_PRO 3)
    expect(db.state.entitlements.get('telegram_sessions')).toBe(1);
  });

  it('subscription.updated de Saver não muda status de tenant suspenso', async () => {
    makeTenant({ status: 'SUSPENDED' });
    await run(ev('subscription.updated'));
    expect(db.state.tenant!.status).toBe('SUSPENDED');
    expect(hub.fetchByCustomer).not.toHaveBeenCalled();
    expect(row('SAVER')).toMatchObject({ status: 'ACTIVE' });
  });

  it('Saver em tenant cancelado sem Afiliados na central: reativa e Afiliados inativo', async () => {
    makeTenant({ status: 'CANCELLED' });
    hub.fetchByCustomer.mockResolvedValue(hubOk([hubSub({ billingStatus: 'REFUNDED' }), saverSub()]));
    await run(ev('subscription.activated'));
    expect(db.state.tenant!.status).toBe('ACTIVE');
    expect(row('AFFILIATES')).toMatchObject({ status: 'INACTIVE', source: 'BILLING' });
    expect(row('AFFILIATES')!.inactiveSince).toBeInstanceOf(Date);
  });

  it.each([
    ['assinatura de Afiliados', hubSub()],
    ['plano desconhecido', hubSub({ planSlug: 'plano-x' })],
  ])('Saver em tenant cancelado com %s dando acesso: nenhuma linha AFFILIATES', async (_n, other) => {
    makeTenant({ status: 'CANCELLED' });
    hub.fetchByCustomer.mockResolvedValue(hubOk([other, saverSub()]));
    await run(ev('subscription.activated'));
    expect(db.state.tenant!.status).toBe('ACTIVE');
    expect(row('AFFILIATES')).toBeUndefined();
  });

  it('Saver em tenant cancelado com central fora: HUB_UNAVAILABLE sem recibo', async () => {
    makeTenant({ status: 'CANCELLED' });
    hub.fetchByCustomer.mockResolvedValue({ ok: false, reason: 'timeout' });
    expect(await run(ev('subscription.activated'))).toEqual({ outcome: 'HUB_UNAVAILABLE', reason: 'timeout' });
    expect(db.state.receipts.size).toBe(0);
    expect(db.state.tenant!.status).toBe('CANCELLED');
  });

  it('bloqueio do super admin: status intocado, linha segue o snapshot', async () => {
    makeTenant({ status: 'SUSPENDED', adminBlockedAt: new Date() });
    hub.fetchByCustomer.mockResolvedValue(hubOk([saverSub()]));
    await run(ev('subscription.activated'));
    expect(db.state.tenant!.status).toBe('SUSPENDED');
    expect(row('AFFILIATES')).toMatchObject({ status: 'INACTIVE' });
    expect(row('SAVER')).toMatchObject({ status: 'ACTIVE' });
  });

  it('corte de Afiliados com Saver ativo: KEPT_ACTIVE e Afiliados inativo', async () => {
    makeTenant();
    db.addRow('SAVER', 'ACTIVE', { planSlug: 'SAVER_PRO' });
    hub.fetchByCustomer.mockResolvedValue(hubOk([hubSub({ billingStatus: 'REFUNDED' }), saverSub()]));
    const out = await run(ev('subscription.refunded', { planSlug: 'copysync-pro-mensal' }));
    expect(out).toMatchObject({ outcome: 'KEPT_ACTIVE' });
    expect(db.state.tenant!.status).toBe('ACTIVE');
    expect(row('AFFILIATES')).toMatchObject({ status: 'INACTIVE' });
    expect(row('SAVER')).toMatchObject({ status: 'ACTIVE' });
  });

  it('corte de Afiliados com plano desconhecido dando acesso: Afiliados intocado', async () => {
    makeTenant();
    db.addRow('SAVER', 'ACTIVE', { planSlug: 'SAVER_PRO' });
    hub.fetchByCustomer.mockResolvedValue(hubOk([hubSub({ billingStatus: 'REFUNDED' }), hubSub({ id: 'x', planSlug: 'plano-x' }), saverSub()]));
    expect(await run(ev('subscription.canceled', { planSlug: 'copysync-pro-mensal' }))).toMatchObject({ outcome: 'KEPT_ACTIVE' });
    expect(row('AFFILIATES')).toBeUndefined();
    expect(db.state.tenant!.planSlug).toBe('COPYSYNC_PRO');
  });

  it('corte total: tenant bloqueado, sem linha AFFILIATES, Saver inativo com inactiveSince', async () => {
    makeTenant();
    db.addRow('SAVER', 'ACTIVE', { planSlug: 'SAVER_PRO' });
    hub.fetchByCustomer.mockResolvedValue(hubOk([hubSub({ billingStatus: 'REFUNDED' }), saverSub({ billingStatus: 'REFUNDED' })]));
    expect(await run(ev('subscription.refunded'))).toMatchObject({ outcome: 'APPLIED' });
    expect(db.state.tenant!.status).toBe('CANCELLED');
    expect(row('AFFILIATES')).toBeUndefined();
    expect(row('SAVER')).toMatchObject({ status: 'INACTIVE' });
    expect(row('SAVER')!.inactiveSince).toBeInstanceOf(Date);
  });

  it('linha de origem ADMIN nunca é desativada pelo corte', async () => {
    makeTenant();
    db.addRow('SAVER', 'ACTIVE', { planSlug: 'SAVER_PRO', source: 'ADMIN' });
    hub.fetchByCustomer.mockResolvedValue(hubOk([hubSub()]));
    await run(ev('subscription.canceled', { planSlug: 'copysync-saver-pro-mensal' }));
    expect(row('SAVER')).toMatchObject({ status: 'ACTIVE', source: 'ADMIN' });
  });

  it('ativação COPYSYNC_* com linha AFFILIATES inativa volta a ativa', async () => {
    makeTenant({ planSlug: null });
    db.addRow('AFFILIATES', 'INACTIVE');
    db.addRow('SAVER', 'ACTIVE', { planSlug: 'SAVER_LITE' });
    await run(ev('subscription.activated', { planSlug: 'copysync-pro-mensal' }));
    expect(row('AFFILIATES')).toMatchObject({ status: 'ACTIVE', planSlug: 'COPYSYNC_PRO', inactiveSince: null });
    expect(db.state.tenant!.planSlug).toBe('COPYSYNC_PRO');
    expect(db.state.entitlements.get('whatsapp_sessions')).toBe(2); // max(PRO 2, SAVER_LITE 1)
    expect(invalidate).toHaveBeenCalledWith('tenant-1');
  });

  it('tenant legado ilimitado que soma Saver não ganha whatsapp_sessions nem telegram_sessions', async () => {
    makeTenant({ planSlug: null });
    await run(ev('subscription.activated'));
    expect(row('SAVER')).toMatchObject({ status: 'ACTIVE' });
    expect(db.state.entitlements.has('whatsapp_sessions')).toBe(false);
    expect(db.state.entitlements.has('telegram_sessions')).toBe(false);
    expect(db.state.entitlements.get('saver_contacts')).toBe(1000);
  });

  it('evento de Afiliados em tenant sem linha de produto não lê nem grava produtos', async () => {
    makeTenant();
    await run(ev('subscription.renewed', { planSlug: 'copysync-max-mensal' }));
    expect(db.state.products.size).toBe(0);
    expect(db.state.entitlements.get('offer_generations_per_day')).toBe(Prisma.JsonNull);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
