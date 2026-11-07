import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import type { HubSubscriptionsResult, IHubSubscriptionsClient } from '../../application/ports/IHubSubscriptionsClient';
import type { HubSubscription } from '../../domain/services/subscriptionReconcile';
import { ApplyBillingEventUseCase } from '../../billing/ApplyBillingEventUseCase';
import { ReconcileSubscriptionsUseCase } from '../../billing/ReconcileSubscriptionsUseCase';
import { PrismaBillingReconcileRepository } from './PrismaBillingReconcileRepository';

/** Reconciliação contra Postgres real: trava FOR UPDATE, watermark só sobe, corrida com o webhook. */
const stamp = Date.now();
const created: string[] = [];
const snapshots = new Map<string, HubSubscriptionsResult>();
const client: IHubSubscriptionsClient = {
  fetchByCustomer: async (id) => snapshots.get(id) ?? { ok: false, reason: 'http_error', status: 404 },
};
const repo = new PrismaBillingReconcileRepository(prisma);
const reconcile = () => new ReconcileSubscriptionsUseCase(client, repo, { batchSize: 1000, leaseTtlMs: 60_000 }, undefined, () => undefined).execute();
const sub = (o: Partial<HubSubscription> = {}): HubSubscription => ({
  id: `s-${stamp}`, planSlug: 'copysync-pro-mensal', billingStatus: 'ACTIVE', expiresAt: null, deletedAt: null, ...o,
});

async function tenant(tag: string, data: { planSlug?: string | null; lastBillingEventSeq?: bigint | null; status?: 'ACTIVE' | 'SUSPENDED'; suspendedAt?: Date }) {
  const customer = `int-rec-${tag}-${stamp}`;
  const t = await prisma.tenant.create({ data: { name: tag, slug: `int-rec-${tag}-${stamp}`, billingCustomerId: customer, ...data } });
  created.push(t.id);
  return { id: t.id, customer };
}
const read = (id: string) => prisma.tenant.findUniqueOrThrow({ where: { id } });
const snap = (customer: string, subscriptions: HubSubscription[], lastSeq: bigint | null) =>
  snapshots.set(customer, { ok: true, snapshot: { externalUserId: customer, subscriptions, lastSeq } });

afterAll(async () => {
  await prisma.billingEventReceipt.deleteMany({ where: { tenantId: { in: created } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: created } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: created } } });
  await prisma.tenant.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe('Reconciliação com Postgres', () => {
  it('corrige tenant sem plano: plano, watermark, auditoria e carimbo do rodízio', async () => {
    const t = await tenant('sem-plano', { planSlug: null, lastBillingEventSeq: 2n });
    snap(t.customer, [sub()], 5n);
    const summary = await reconcile();
    expect(summary!.corrected).toBeGreaterThanOrEqual(1);
    const row = await read(t.id);
    expect(row).toMatchObject({ planSlug: 'COPYSYNC_PRO', status: 'ACTIVE', lastBillingEventSeq: 5n });
    expect(row.billingReconciledAt).not.toBeNull();
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: t.id, action: 'TENANT_UPDATED' } });
    expect(audit.meta).toMatchObject({ origin: 'BILLING_RECONCILE', reasons: ['no_plan', 'watermark_behind'], previousSeq: '2', lastSeq: '5' });
    expect(await prisma.jobLease.count({ where: { name: 'billing-reconcile' } })).toBe(0);
  });

  it('não regride watermark: resposta mais velha que o evento aplicado é ignorada', async () => {
    const t = await tenant('stale', { planSlug: 'COPYSYNC_LITE', lastBillingEventSeq: 9n });
    snap(t.customer, [sub()], 5n);
    await reconcile();
    expect(await read(t.id)).toMatchObject({ planSlug: 'COPYSYNC_LITE', lastBillingEventSeq: 9n });
  });

  it('suspende quando nenhuma assinatura dá acesso; não reativa suspensão de super-admin', async () => {
    const refunded = await tenant('refund', { planSlug: 'COPYSYNC_PRO', lastBillingEventSeq: 3n });
    snap(refunded.customer, [sub({ billingStatus: 'REFUNDED', expiresAt: '2099-01-01T00:00:00Z' })], 4n);
    const suspendedAt = new Date();
    const admin = await tenant('admin', { planSlug: 'COPYSYNC_PRO', status: 'SUSPENDED', suspendedAt, lastBillingEventSeq: 1n });
    await prisma.auditLog.create({ data: { tenantId: admin.id, action: 'TENANT_STATUS_CHANGED', meta: { origin: 'SUPER_ADMIN', previousStatus: 'ACTIVE', newStatus: 'SUSPENDED' } } });
    snap(admin.customer, [sub()], 1n);
    await reconcile();
    expect(await read(refunded.id)).toMatchObject({ status: 'SUSPENDED', lastBillingEventSeq: 4n });
    expect(await prisma.auditLog.count({ where: { tenantId: refunded.id, action: 'TENANT_STATUS_CHANGED' } })).toBe(1);
    expect((await read(admin.id)).status).toBe('SUSPENDED');
  });

  it('espera a trava do webhook e relê: evento mais novo aplicado durante a espera vence', async () => {
    const t = await tenant('lock', { planSlug: null, lastBillingEventSeq: 4n });
    snap(t.customer, [sub()], 5n);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => { locked = r; });
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "tenants" WHERE "id" = ${t.id} FOR UPDATE`;
      locked();
      await gate;
      await tx.tenant.update({ where: { id: t.id }, data: { lastBillingEventSeq: 6n, status: 'SUSPENDED', suspendedAt: new Date() } });
    }, { timeout: 20_000 });
    await isLocked;
    let done = false;
    const run = reconcile().then((s) => { done = true; return s; });
    await new Promise((r) => setTimeout(r, 400));
    expect(done).toBe(false);
    release();
    await holder;
    expect((await run)!.stale).toBeGreaterThanOrEqual(1);
    expect(await read(t.id)).toMatchObject({ planSlug: null, status: 'SUSPENDED', lastBillingEventSeq: 6n });
  });

  it('corrida com o Apply: em qualquer ordem o evento mais novo prevalece', async () => {
    const t = await tenant('race', { planSlug: null, lastBillingEventSeq: 4n });
    snap(t.customer, [sub()], 5n);
    const apply = new ApplyBillingEventUseCase().execute({
      eventId: `race-${stamp}`, billingCustomerId: t.customer, eventType: 'subscription.payment_failed', seq: 6n, payload: {},
    });
    const [applied] = await Promise.all([apply, reconcile()]);
    expect(applied.outcome).toBe('APPLIED');
    expect(await read(t.id)).toMatchObject({ status: 'SUSPENDED', lastBillingEventSeq: 6n });
  });

  it('webhook de corte pela união: renovação + expired da linha antiga mantém; central fora não grava recibo', async () => {
    const t = await tenant('union', { planSlug: 'COPYSYNC_PRO', lastBillingEventSeq: 10n });
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const down = new ApplyBillingEventUseCase(undefined, { fetchByCustomer: async () => ({ ok: false, reason: 'timeout' }) });
    const ev = { eventId: `union-${stamp}`, billingCustomerId: t.customer, eventType: 'subscription.expired', seq: 11n, payload: {} };
    expect(await down.execute(ev)).toEqual({ outcome: 'HUB_UNAVAILABLE', reason: 'timeout' });
    expect(await prisma.billingEventReceipt.count({ where: { eventId: ev.eventId } })).toBe(0);
    expect((await read(t.id)).lastBillingEventSeq).toBe(10n);

    snap(t.customer, [sub({ id: 'old', billingStatus: 'EXPIRED', expiresAt: '2026-01-01T00:00:00Z' }), sub({ id: 'new', expiresAt: future })], 11n);
    const up = new ApplyBillingEventUseCase(undefined, client);
    expect(await up.execute(ev)).toEqual({ outcome: 'KEPT_ACTIVE', tenantId: t.id });
    expect(await read(t.id)).toMatchObject({ status: 'ACTIVE', lastBillingEventSeq: 11n, subscriptionExpiresAt: new Date(future) });
    expect((await prisma.billingEventReceipt.findUniqueOrThrow({ where: { eventId: ev.eventId } })).outcome).toBe('KEPT_ACTIVE');
  });
});
