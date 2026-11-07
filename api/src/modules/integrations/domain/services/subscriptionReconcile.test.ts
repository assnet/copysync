import { describe, expect, it } from 'vitest';
import { decideReconcile, graceMsFromHours, pickGrantingSubscription, subscriptionGrantsAccess, type HubSubscription } from './subscriptionReconcile';

const NOW = new Date('2026-11-07T12:00:00Z');
const G = graceMsFromHours(24);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const FUTURE = '2026-12-07T12:00:00Z';
const sub = (o: Partial<HubSubscription> = {}): HubSubscription => ({
  id: 's1', planSlug: 'copysync-pro-mensal', billingStatus: 'ACTIVE', expiresAt: null, deletedAt: null, ...o,
});

describe('subscriptionGrantsAccess (tolerância de 24 h; cancelamento/estorno cortam na hora)', () => {
  it.each([
    ['ACTIVE sem vencimento', {}, true],
    ['legado (status null)', { billingStatus: null }, true],
    ['TRIAL_ACTIVE', { billingStatus: 'TRIAL_ACTIVE' }, true],
    ['ACTIVE vencida há 23 h', { expiresAt: hoursAgo(23) }, true],
    ['ACTIVE vencida há 25 h', { expiresAt: hoursAgo(25) }, false],
    ['EXPIRED (cron) há 23 h', { billingStatus: 'EXPIRED', expiresAt: hoursAgo(23) }, true],
    ['EXPIRED há 25 h', { billingStatus: 'EXPIRED', expiresAt: hoursAgo(25) }, false],
    ['PAYMENT_FAILED dentro da tolerância', { billingStatus: 'PAYMENT_FAILED', expiresAt: hoursAgo(2) }, true],
    ['PAYMENT_FAILED sem vencimento', { billingStatus: 'PAYMENT_FAILED' }, false],
    ['CANCELED com vencimento futuro', { billingStatus: 'CANCELED', expiresAt: FUTURE }, false],
    ['REFUNDED com vencimento futuro', { billingStatus: 'REFUNDED', expiresAt: FUTURE }, false],
    ['canceledAt (admin) com ACTIVE e futuro', { canceledAt: hoursAgo(1), expiresAt: FUTURE }, false],
    ['refundedAt', { refundedAt: hoursAgo(1) }, false],
    ['chargedbackAt', { chargedbackAt: hoursAgo(1) }, false],
    ['deletedAt', { deletedAt: hoursAgo(1) }, false],
    ['PENDING_CANCELLATION', { billingStatus: 'PENDING_CANCELLATION', expiresAt: FUTURE }, false],
    ['TRIAL_ENDED_PENDING', { billingStatus: 'TRIAL_ENDED_PENDING', expiresAt: FUTURE }, false],
    ['data inválida', { expiresAt: 'lixo' }, false],
  ] as Array<[string, Partial<HubSubscription>, boolean]>)('%s → %s', (_n, o, expected) => {
    expect(subscriptionGrantsAccess(sub(o), NOW, G)).toBe(expected);
  });

  it('tolerância configurável: 0 h corta no vencimento', () => {
    expect(subscriptionGrantsAccess(sub({ expiresAt: hoursAgo(1) }), NOW, 0)).toBe(false);
  });
});

describe('pickGrantingSubscription', () => {
  it('maior plano; empate = vencimento mais distante, depois menor id', () => {
    const subs = [
      sub({ id: 'a', planSlug: 'copysync-lite-mensal' }),
      sub({ id: 'c', planSlug: 'copysync-max-mensal', expiresAt: '2026-12-01T00:00:00Z' }),
      sub({ id: 'b', planSlug: 'COPYSYNC_MAX', expiresAt: '2027-01-01T00:00:00Z' }),
    ];
    expect(pickGrantingSubscription(subs, NOW, G)).toMatchObject({ grants: true, planSlug: 'COPYSYNC_MAX', sub: { id: 'b' } });
    expect(pickGrantingSubscription([sub({ id: 'z' }), sub({ id: 'y' })], NOW, G).sub?.id).toBe('y');
  });

  it('acesso só com plano desconhecido → planSlug null', () => {
    expect(pickGrantingSubscription([sub({ planSlug: 'x' })], NOW, G)).toEqual({ grants: true, sub: null, planSlug: null });
    expect(pickGrantingSubscription([], NOW, G)).toEqual({ grants: false, sub: null, planSlug: null });
  });
});

describe('decideReconcile', () => {
  const local = { status: 'ACTIVE' as const, planSlug: 'COPYSYNC_PRO', lastBillingEventSeq: 5n, blockedByAdmin: false };
  const snap = (lastSeq: bigint | null, subscriptions = [sub()]) => ({ externalUserId: 'c', subscriptions, lastSeq });

  it('central sem evento e tenant com watermark: stale (não mexe)', () => {
    expect(decideReconcile(local, snap(null), NOW, G)).toEqual({ kind: 'stale' });
  });
  it('ambos sem watermark e iguais: noop; sem plano: aplica sem mexer no watermark', () => {
    expect(decideReconcile({ ...local, lastBillingEventSeq: null }, snap(null), NOW, G)).toEqual({ kind: 'noop' });
    expect(decideReconcile({ ...local, planSlug: null, lastBillingEventSeq: null }, snap(null), NOW, G))
      .toMatchObject({ kind: 'apply', reasons: ['no_plan'], advanceTo: null });
  });
  it('CANCELLED e SUSPENDED sem acesso: noop', () => {
    expect(decideReconcile({ ...local, status: 'CANCELLED', planSlug: null }, snap(5n, [sub({ billingStatus: 'REFUNDED' })]), NOW, G)).toEqual({ kind: 'noop' });
    expect(decideReconcile({ ...local, status: 'SUSPENDED' }, snap(5n, []), NOW, G)).toEqual({ kind: 'noop' });
  });
  it('ACTIVE sem acesso: suspende com watermark; lista vazia: unknown_customer; stale vence a suspensão', () => {
    expect(decideReconcile(local, snap(6n, [sub({ billingStatus: 'REFUNDED' })]), NOW, G)).toEqual({ kind: 'suspend', advanceTo: 6n });
    expect(decideReconcile({ ...local, lastBillingEventSeq: null }, snap(null, []), NOW, G)).toEqual({ kind: 'unknown_customer' });
    expect(decideReconcile({ ...local, lastBillingEventSeq: 7n }, snap(6n, [sub({ billingStatus: 'REFUNDED' })]), NOW, G)).toEqual({ kind: 'stale' });
  });
  it('vencida há 23 h mantém; há 25 h suspende', () => {
    expect(decideReconcile(local, snap(5n, [sub({ expiresAt: hoursAgo(23) })]), NOW, G)).toEqual({ kind: 'noop' });
    expect(decideReconcile(local, snap(5n, [sub({ expiresAt: hoursAgo(25) })]), NOW, G)).toEqual({ kind: 'suspend', advanceTo: 5n });
  });
  it('CANCELLED por cobrança com acesso: reativa com plano; por super-admin: não', () => {
    expect(decideReconcile({ ...local, status: 'CANCELLED', planSlug: 'COPYSYNC_LITE' }, snap(5n), NOW, G))
      .toMatchObject({ kind: 'apply', reasons: ['plan_changed', 'billing_cancelled'], activate: true, planSlug: 'COPYSYNC_PRO' });
    expect(decideReconcile({ ...local, status: 'CANCELLED', blockedByAdmin: true }, snap(5n), NOW, G)).toEqual({ kind: 'admin_suspended' });
  });
  it('canceledAt preenchido com billingStatus ACTIVE corta na hora (central 1.89.2)', () => {
    const s1 = sub({ billingStatus: 'ACTIVE', canceledAt: hoursAgo(0.5), refundedAt: null, chargedbackAt: null, expiresAt: FUTURE });
    expect(subscriptionGrantsAccess(s1, NOW, G)).toBe(false);
    expect(decideReconcile(local, snap(5n, [s1]), NOW, G)).toEqual({ kind: 'suspend', advanceTo: 5n });
  });
  it('vencimento da assinatura escolhida vai junto', () => {
    const d = decideReconcile({ ...local, planSlug: null }, snap(5n, [sub({ expiresAt: FUTURE })]), NOW, G);
    expect(d).toMatchObject({ kind: 'apply', expiresAt: new Date(FUTURE), subscriptionId: 's1' });
  });
});
