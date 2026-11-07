import { describe, expect, it, vi } from 'vitest';
import type { IBillingReconcileRepository, ReconcileCandidate } from '../application/ports/IBillingReconcileRepository';
import type { HubSubscriptionsResult, IHubSubscriptionsClient } from '../application/ports/IHubSubscriptionsClient';
import type { HubSubscription, LocalBillingState, ReconcileDecision } from '../domain/services/subscriptionReconcile';
import { ReconcileSubscriptionsUseCase } from './ReconcileSubscriptionsUseCase';

const NOW = new Date('2026-11-07T12:00:00Z');
const sub = (o: Partial<HubSubscription> = {}): HubSubscription => ({
  id: 's1', planSlug: 'copysync-pro-mensal', billingStatus: 'ACTIVE', expiresAt: '2026-12-07T12:00:00Z', deletedAt: null, ...o,
});
const ok = (subscriptions: HubSubscription[], lastSeq: bigint | null = 5n): HubSubscriptionsResult => ({
  ok: true, snapshot: { externalUserId: 'c', subscriptions, lastSeq },
});
const state = (o: Partial<LocalBillingState> = {}): LocalBillingState => ({
  status: 'ACTIVE', planSlug: 'COPYSYNC_PRO', lastBillingEventSeq: 5n, suspendedByAdmin: false, ...o,
});

/** Repositório em memória: guarda o estado, chama `decide` e aplica como o Prisma (watermark só sobe). */
function harness(states: Record<string, LocalBillingState>, results: Record<string, HubSubscriptionsResult>, lease = true) {
  const applied: Array<{ tenantId: string; decision: ReconcileDecision }> = [];
  const marked: string[] = [];
  const repo: IBillingReconcileRepository = {
    acquireLease: vi.fn(async () => lease),
    releaseLease: vi.fn(async () => undefined),
    listCandidates: vi.fn(async (limit: number): Promise<ReconcileCandidate[]> =>
      Object.keys(states).slice(0, limit).map((id) => ({ tenantId: id, billingCustomerId: `c-${id}` }))),
    markExamined: vi.fn(async (id: string) => { marked.push(id); }),
    reconcileLocked: vi.fn(async (c: ReconcileCandidate, decide: (s: LocalBillingState) => ReconcileDecision) => {
      const s = states[c.tenantId]!;
      const decision = decide(s);
      if (decision.kind === 'suspend') {
        s.status = 'SUSPENDED';
        if (decision.advanceTo !== null && (s.lastBillingEventSeq === null || s.lastBillingEventSeq < decision.advanceTo)) {
          s.lastBillingEventSeq = decision.advanceTo;
        }
      }
      if (decision.kind === 'apply') {
        applied.push({ tenantId: c.tenantId, decision });
        s.planSlug = decision.planSlug;
        if (decision.activate) s.status = 'ACTIVE';
        if (decision.advanceTo !== null && (s.lastBillingEventSeq === null || s.lastBillingEventSeq < decision.advanceTo)) {
          s.lastBillingEventSeq = decision.advanceTo;
        }
      }
      return { decision, found: true };
    }),
  };
  const client: IHubSubscriptionsClient = {
    fetchByCustomer: vi.fn(async (id: string) => results[id.slice(2)]!),
  };
  const notified: string[] = [];
  const uc = new ReconcileSubscriptionsUseCase(client, repo, { batchSize: 10, leaseTtlMs: 1000, graceMs: 24 * 3_600_000 }, () => NOW, (id) => notified.push(id));
  return { uc, repo, client, applied, marked, notified };
}

describe('ReconcileSubscriptionsUseCase', () => {
  it('a) tenant sem plano: aplica plano da central e sobe o watermark', async () => {
    const states = { t1: state({ planSlug: null, lastBillingEventSeq: 3n }) };
    const h = harness(states, { t1: ok([sub()], 7n) });
    const summary = await h.uc.execute();
    expect(summary).toMatchObject({ examined: 1, corrected: 1, errors: 0 });
    expect(h.applied[0]!.decision).toMatchObject({ kind: 'apply', planSlug: 'COPYSYNC_PRO', reasons: ['no_plan', 'watermark_behind'], advanceTo: 7n });
    expect(states.t1).toMatchObject({ planSlug: 'COPYSYNC_PRO', lastBillingEventSeq: 7n });
  });

  it('a) plano diferente troca; SUSPENDED por cobrança reativa', async () => {
    const states = { t1: state({ planSlug: 'COPYSYNC_LITE' }), t2: state({ status: 'SUSPENDED' }) };
    const h = harness(states, { t1: ok([sub({ planSlug: 'copysync-max-anual' })]), t2: ok([sub()]) });
    expect(await h.uc.execute()).toMatchObject({ corrected: 2 });
    expect(h.applied.map((a) => a.decision)).toMatchObject([
      { reasons: ['plan_changed'], planSlug: 'COPYSYNC_MAX', activate: false },
      { reasons: ['billing_suspended'], activate: true },
    ]);
    expect(states.t2.status).toBe('ACTIVE');
  });

  it('a) só o watermark atrás: reaplica o estado e sobe', async () => {
    const states = { t1: state({ lastBillingEventSeq: 4n }) };
    const h = harness(states, { t1: ok([sub()], 9n) });
    await h.uc.execute();
    expect(h.applied[0]!.decision).toMatchObject({ reasons: ['watermark_behind'], advanceTo: 9n });
    expect(states.t1.lastBillingEventSeq).toBe(9n);
  });

  it('b) recorrência cancelada na Cakto (central segue ACTIVE) e vencida há 23 h: mantém', async () => {
    const h = harness({ t1: state() }, { t1: ok([sub({ expiresAt: '2026-11-06T13:00:00Z' })]) });
    expect(await h.uc.execute()).toMatchObject({ corrected: 0, suspended: 0 });
  });

  it('b) vencida há 25 h, cancelamento de admin (canceledAt) e reembolso: suspende na hora, watermark e notifica', async () => {
    const states = { t1: state({ lastBillingEventSeq: 4n }), t2: state(), t3: state() };
    const h = harness(states, {
      t1: ok([sub({ billingStatus: 'EXPIRED', expiresAt: '2026-11-06T11:00:00Z' })], 8n),
      t2: ok([sub({ canceledAt: '2026-11-07T10:00:00Z', expiresAt: '2026-12-01T00:00:00Z' })]),
      t3: ok([sub({ billingStatus: 'REFUNDED', expiresAt: '2026-12-01T00:00:00Z' })]),
    });
    expect(await h.uc.execute()).toMatchObject({ suspended: 3, corrected: 0 });
    expect(states.t1).toMatchObject({ status: 'SUSPENDED', lastBillingEventSeq: 8n });
    expect(h.notified).toEqual(['t1', 't2', 't3']);
  });

  it('b) PAYMENT_FAILED dentro da tolerância: mantém', async () => {
    const h = harness({ t1: state() }, { t1: ok([sub({ billingStatus: 'PAYMENT_FAILED', expiresAt: '2026-11-07T06:00:00Z' })]) });
    expect(await h.uc.execute()).toMatchObject({ suspended: 0 });
  });

  it('b) central sem nenhuma assinatura (cliente desconhecido): não suspende', async () => {
    const states = { t1: state() };
    const h = harness(states, { t1: ok([], null) , });
    states.t1.lastBillingEventSeq = null;
    expect(await h.uc.execute()).toMatchObject({ unknownCustomer: 1, suspended: 0 });
    expect(states.t1.status).toBe('ACTIVE');
    expect(h.notified).toEqual([]);
  });

  it('c) iguais: no-op', async () => {
    const h = harness({ t1: state() }, { t1: ok([sub()], 5n) });
    expect(await h.uc.execute()).toMatchObject({ examined: 1, corrected: 0, suspended: 0, stale: 0, errors: 0 });
    expect(h.applied).toHaveLength(0);
  });

  it('watermark local à frente do lastSeq: stale, nunca desce', async () => {
    const states = { t1: state({ planSlug: 'COPYSYNC_LITE', lastBillingEventSeq: 12n }) };
    const h = harness(states, { t1: ok([sub()], 10n) });
    expect(await h.uc.execute()).toMatchObject({ stale: 1, corrected: 0 });
    expect(states.t1).toMatchObject({ planSlug: 'COPYSYNC_LITE', lastBillingEventSeq: 12n });
  });

  it('suspenso por super-admin não reativa; plano desconhecido não aplica', async () => {
    const h = harness(
      { t1: state({ status: 'SUSPENDED', suspendedByAdmin: true }), t2: state({ planSlug: null }) },
      { t1: ok([sub()]), t2: ok([sub({ planSlug: 'outro-produto' })]) },
    );
    expect(await h.uc.execute()).toMatchObject({ adminSuspended: 1, unknownPlan: 1, corrected: 0 });
  });

  it('d) erro HTTP/401/timeout: não muda nada, conta e segue para o próximo', async () => {
    const states = { t1: state({ planSlug: null }), t2: state({ planSlug: null }), t3: state({ planSlug: null }), t4: state({ planSlug: null }) };
    const h = harness(states, {
      t1: { ok: false, reason: 'unauthorized', status: 401 },  // 404/400 do cliente também caem aqui
      t2: { ok: false, reason: 'timeout' },
      t3: { ok: false, reason: 'http_error', status: 503 },
      t4: ok([sub()]),
    });
    expect(await h.uc.execute()).toMatchObject({ examined: 4, errors: 3, corrected: 1 });
    expect(h.repo.reconcileLocked).toHaveBeenCalledTimes(1);
    expect(states.t1.planSlug).toBeNull();
    expect(h.notified).toEqual([]);
    expect(h.marked).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('exceção no repositório conta erro e a passada segue; lease liberado', async () => {
    const h = harness({ t1: state({ planSlug: null }), t2: state({ planSlug: null }) }, { t1: ok([sub()]), t2: ok([sub()]) });
    vi.mocked(h.repo.reconcileLocked).mockRejectedValueOnce(new Error('db'));
    expect(await h.uc.execute()).toMatchObject({ errors: 1, corrected: 1 });
    expect(h.repo.releaseLease).toHaveBeenCalledTimes(1);
  });

  it('lote limitado e lease com outro processo', async () => {
    const h = harness({ t1: state(), t2: state() }, { t1: ok([sub()]), t2: ok([sub()]) });
    await h.uc.execute();
    expect(h.repo.listCandidates).toHaveBeenCalledWith(10);
    const busy = harness({ t1: state() }, { t1: ok([sub()]) }, false);
    expect(await busy.uc.execute()).toBeNull();
    expect(busy.client.fetchByCustomer).not.toHaveBeenCalled();
    expect(busy.repo.releaseLease).not.toHaveBeenCalled();
  });
});
