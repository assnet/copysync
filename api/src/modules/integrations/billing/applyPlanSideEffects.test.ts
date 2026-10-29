import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Client Prisma em memória: só o que o billing e os efeitos de plano usam. `tx` marca quem rodou na transação. */
const db = vi.hoisted(() => {
  const state = {
    entitlements: new Map<string, string>(),
    storefrontStatus: null as string | null,
    /** Valor de `storefront_enabled` no preset do plano. */
    planStorefront: 'false',
    calls: [] as Array<{ op: string; inTx: boolean }>,
  };
  const make = (inTx: boolean) => ({
    billingEventReceipt: { findUnique: async () => null, create: async () => ({}) },
    tenant: {
      findUnique: async () => ({ id: 'tenant-1', status: 'ACTIVE', lastBillingEventSeq: null }),
      update: async () => ({}),
      updateMany: async () => ({ count: 1 }),
    },
    planEntitlementPreset: {
      findMany: async () => [{ key: 'storefront_enabled', value: state.planStorefront }],
    },
    tenantEntitlement: {
      upsert: async ({ create }: { create: { key: string; value: string } }) => { state.entitlements.set(create.key, create.value); return {}; },
      findUnique: async ({ where }: { where: { tenantId_key: { key: string } } }) => {
        const value = state.entitlements.get(where.tenantId_key.key);
        return value === undefined ? null : { value };
      },
    },
    storefront: {
      updateMany: async ({ data }: { data: { status: string } }) => {
        state.calls.push({ op: 'storefront.updateMany', inTx });
        if (state.storefrontStatus === null) return { count: 0 };
        state.storefrontStatus = data.status;
        return { count: 1 };
      },
    },
  });
  const tx = make(true);
  const prisma = { ...make(false), $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  return { state, prisma, tx };
});

const linkRotationLimits = vi.hoisted(() => vi.fn(async () => ({ rotationsChanged: 0 })));

vi.mock('../../../shared/database/prisma.client', () => ({ prisma: db.prisma }));
vi.mock('../../link-rotation/infrastructure/linkRotationPlanLimits', () => ({ applyLinkRotationPlanLimits: linkRotationLimits }));

import { applyPlanSideEffects } from './applyPlanSideEffects';
import { ApplyBillingEventUseCase } from './ApplyBillingEventUseCase';
import { SyncTenantEntitlementsUseCase } from './SyncTenantEntitlementsUseCase';

beforeEach(() => {
  db.state.entitlements.clear();
  db.state.calls.length = 0;
  db.state.storefrontStatus = 'ACTIVE';
  db.state.planStorefront = 'false';
  linkRotationLimits.mockClear();
});

describe('applyPlanSideEffects', () => {
  it('aplica rodízio e vitrine no client recebido', async () => {
    db.state.entitlements.set('storefront_enabled', 'false');
    const out = await applyPlanSideEffects(db.tx as never, 'tenant-1');
    expect(linkRotationLimits).toHaveBeenCalledWith(db.tx, 'tenant-1');
    expect(db.state.storefrontStatus).toBe('PAUSED_BY_PLAN');
    expect(out.storefront).toBe('PAUSED_BY_PLAN');
  });

  it('tenant sem página: vitrine devolve null', async () => {
    db.state.storefrontStatus = null;
    db.state.entitlements.set('storefront_enabled', 'true');
    expect((await applyPlanSideEffects(db.tx as never, 'tenant-1')).storefront).toBeNull();
  });
});

describe('efeito da vitrine nos dois caminhos do billing', () => {
  it('evento de assinatura: pausa a página dentro da transação', async () => {
    await new ApplyBillingEventUseCase().execute({
      eventId: 'ev-1', billingCustomerId: 'cus-1', eventType: 'subscription.updated', seq: 1, payload: { planSlug: 'starter' },
    });
    expect(db.state.storefrontStatus).toBe('PAUSED_BY_PLAN');
    expect(db.state.calls).toEqual([{ op: 'storefront.updateMany', inTx: true }]);
    expect(linkRotationLimits).toHaveBeenCalledWith(db.tx, 'tenant-1');
  });

  it('sync de entitlements: reativa a página dentro da transação', async () => {
    db.state.storefrontStatus = 'PAUSED_BY_PLAN';
    db.state.planStorefront = 'true';
    await new SyncTenantEntitlementsUseCase().execute('tenant-1', 'pro');
    expect(db.state.storefrontStatus).toBe('ACTIVE');
    expect(db.state.calls).toEqual([{ op: 'storefront.updateMany', inTx: true }]);
    expect(linkRotationLimits).toHaveBeenCalledWith(db.tx, 'tenant-1');
  });
});
