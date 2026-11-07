import { describe, expect, it } from 'vitest';
import { decideReconcile, pickGrantingSubscription, subscriptionGrantsAccess, type HubSubscription } from './subscriptionReconcile';

const NOW = new Date('2026-11-07T12:00:00Z');
const sub = (o: Partial<HubSubscription> = {}): HubSubscription => ({
  id: 's1', planSlug: 'copysync-pro-mensal', billingStatus: 'ACTIVE', expiresAt: null, deletedAt: null, ...o,
});

describe('subscriptionGrantsAccess (critério da central)', () => {
  it.each([
    [{}, true],
    [{ billingStatus: null }, true],
    [{ billingStatus: 'TRIAL_ACTIVE' }, true],
    [{ billingStatus: 'PAYMENT_FAILED' }, false],
    [{ billingStatus: 'CANCELED' }, false],
    [{ billingStatus: 'CANCELED', expiresAt: '2026-11-08T00:00:00Z' }, true],
    [{ billingStatus: 'CANCELED', expiresAt: '2026-11-06T00:00:00Z' }, false],
    [{ billingStatus: 'PENDING_CANCELLATION', expiresAt: '2026-11-08T00:00:00Z' }, true],
    [{ billingStatus: 'REFUNDED' }, false],
    [{ billingStatus: 'REFUNDED', expiresAt: '2026-11-08T00:00:00Z' }, false],
    [{ billingStatus: 'EXPIRED' }, false],
    [{ billingStatus: 'TRIAL_ENDED_PENDING' }, false],
    [{ deletedAt: '2026-11-01T00:00:00Z' }, false],
    [{ expiresAt: '2026-11-07T12:00:00Z' }, true],
    [{ expiresAt: '2026-11-07T11:59:59Z' }, false],
    [{ expiresAt: 'lixo' }, false],
  ] as Array<[Partial<HubSubscription>, boolean]>)('%j → %s', (o, expected) => {
    expect(subscriptionGrantsAccess(sub(o), NOW)).toBe(expected);
  });
});

describe('pickGrantingSubscription', () => {
  it('maior plano; empate = vencimento mais distante, depois menor id', () => {
    const subs = [
      sub({ id: 'a', planSlug: 'copysync-lite-mensal' }),
      sub({ id: 'c', planSlug: 'copysync-max-mensal', expiresAt: '2026-12-01T00:00:00Z' }),
      sub({ id: 'b', planSlug: 'COPYSYNC_MAX', expiresAt: '2027-01-01T00:00:00Z' }),
    ];
    expect(pickGrantingSubscription(subs, NOW)).toMatchObject({ grants: true, planSlug: 'COPYSYNC_MAX', sub: { id: 'b' } });
    expect(pickGrantingSubscription([sub({ id: 'z' }), sub({ id: 'y' })], NOW).sub?.id).toBe('y');
  });

  it('acesso só com plano desconhecido → planSlug null', () => {
    expect(pickGrantingSubscription([sub({ planSlug: 'x' })], NOW)).toEqual({ grants: true, sub: null, planSlug: null });
    expect(pickGrantingSubscription([], NOW)).toEqual({ grants: false, sub: null, planSlug: null });
  });
});

describe('decideReconcile', () => {
  const local = { status: 'ACTIVE' as const, planSlug: 'COPYSYNC_PRO', lastBillingEventSeq: 5n, suspendedByAdmin: false };
  const snap = (lastSeq: bigint | null, subscriptions = [sub()]) => ({ externalUserId: 'c', subscriptions, lastSeq });

  it('central sem evento e tenant com watermark: stale (não mexe)', () => {
    expect(decideReconcile(local, snap(null), NOW)).toEqual({ kind: 'stale' });
  });
  it('ambos sem watermark e iguais: noop; sem plano: aplica sem mexer no watermark', () => {
    expect(decideReconcile({ ...local, lastBillingEventSeq: null }, snap(null), NOW)).toEqual({ kind: 'noop' });
    expect(decideReconcile({ ...local, planSlug: null, lastBillingEventSeq: null }, snap(null), NOW))
      .toMatchObject({ kind: 'apply', reasons: ['no_plan'], advanceTo: null });
  });
  it('CANCELLED e SUSPENDED sem acesso: noop', () => {
    expect(decideReconcile({ ...local, status: 'CANCELLED', planSlug: null }, snap(5n), NOW)).toEqual({ kind: 'noop' });
    expect(decideReconcile({ ...local, status: 'SUSPENDED' }, snap(5n, []), NOW)).toEqual({ kind: 'noop' });
  });
  it('ACTIVE sem acesso: suspende com watermark; lista vazia: unknown_customer; stale vence a suspensão', () => {
    expect(decideReconcile(local, snap(6n, [sub({ billingStatus: 'REFUNDED' })]), NOW)).toEqual({ kind: 'suspend', advanceTo: 6n });
    expect(decideReconcile({ ...local, lastBillingEventSeq: null }, snap(null, []), NOW)).toEqual({ kind: 'unknown_customer' });
    expect(decideReconcile({ ...local, lastBillingEventSeq: 7n }, snap(6n, [sub({ billingStatus: 'REFUNDED' })]), NOW)).toEqual({ kind: 'stale' });
  });
  it('vencimento da assinatura escolhida vai junto', () => {
    const d = decideReconcile({ ...local, planSlug: null }, snap(5n, [sub({ expiresAt: '2026-12-07T12:00:00Z' })]), NOW);
    expect(d).toMatchObject({ kind: 'apply', expiresAt: new Date('2026-12-07T12:00:00Z'), subscriptionId: 's1' });
  });
});
