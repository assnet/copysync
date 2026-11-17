import { describe, expect, it } from 'vitest';
import {
  decideReconcile, graceMsFromHours, pickGrantingByProduct, pickGrantingSubscription,
  type HubSubscription, type LocalBillingState, type LocalProductState,
} from './subscriptionReconcile';
import type { ProductKey } from '../../../tenants/domain/services/resolveProductAccess';

const NOW = new Date('2026-11-07T12:00:00Z');
const G = graceMsFromHours(24);
const FUTURE = '2026-12-07T12:00:00Z';
const LATER = '2027-01-07T12:00:00Z';
const sub = (o: Partial<HubSubscription> = {}): HubSubscription => ({
  id: 's1', planSlug: 'copysync-pro-mensal', billingStatus: 'ACTIVE', expiresAt: null, deletedAt: null, ...o,
});
const saver = (o: Partial<HubSubscription> = {}) => sub({ id: 'sv', planSlug: 'copysync-saver-pro-mensal', expiresAt: FUTURE, ...o });
const local: LocalBillingState = { status: 'ACTIVE', planSlug: 'COPYSYNC_PRO', lastBillingEventSeq: 5n, adminBlocked: false, subscriptionExpiresAt: null };
const snap = (subscriptions: HubSubscription[], lastSeq: bigint | null = 5n) => ({ externalUserId: 'c', subscriptions, lastSeq });
const rows = (entries: Array<[ProductKey, LocalProductState]>) => new Map(entries);

describe('pickGrantingByProduct', () => {
  it('Afiliados escolhe a mesma assinatura que pickGrantingSubscription', () => {
    const subs = [
      sub({ id: 'a', planSlug: 'copysync-lite-mensal' }),
      sub({ id: 'c', planSlug: 'copysync-max-mensal', expiresAt: '2026-12-01T00:00:00Z' }),
      sub({ id: 'b', planSlug: 'COPYSYNC_MAX', expiresAt: '2027-01-01T00:00:00Z' }),
      sub({ id: 'd', planSlug: 'copysync-lite-mensal', permissions: ['COPYSYNC_MAX'] }),
    ];
    const legacy = pickGrantingSubscription(subs, NOW, G);
    const aff = pickGrantingByProduct(subs, NOW, G).byProduct.get('AFFILIATES');
    expect(aff).toEqual({ grants: true, sub: legacy.sub, planSlug: legacy.planSlug });
  });

  it('só Saver: produto SAVER, sem legado', () => {
    const p = pickGrantingByProduct([saver(), saver({ id: 'sw', planSlug: 'x', permissions: ['SAVER_MAX'], expiresAt: LATER })], NOW, G);
    expect([...p.byProduct.keys()]).toEqual(['SAVER']);
    expect(p.byProduct.get('SAVER')).toMatchObject({ grants: true, planSlug: 'SAVER_MAX', sub: { id: 'sw' } });
    expect(p).toMatchObject({ anyGrants: true, legacyGrants: false, unknownGrants: false, hasLegacy: false });
  });

  it('Afiliados cortado com Saver ativo', () => {
    const p = pickGrantingByProduct([sub({ billingStatus: 'REFUNDED' }), saver()], NOW, G);
    expect(p.byProduct.get('AFFILIATES')).toEqual({ grants: false, sub: null, planSlug: null });
    expect(p).toMatchObject({ anyGrants: true, legacyGrants: false, hasLegacy: true });
  });

  it('plano desconhecido com acesso conta a favor de Afiliados', () => {
    const p = pickGrantingByProduct([sub({ planSlug: 'x' }), saver({ billingStatus: 'REFUNDED' })], NOW, G);
    expect(p).toMatchObject({ unknownGrants: true, legacyGrants: true, anyGrants: true, hasLegacy: true });
    expect(p.byProduct.get('SAVER')).toEqual({ grants: false, sub: null, planSlug: null });
  });

  it('assinatura sem acesso não desbanca a que dá acesso, em qualquer ordem', () => {
    const p = pickGrantingByProduct([saver({ id: 'ok' }), saver({ id: 'old', billingStatus: 'CANCELED', planSlug: 'copysync-saver-max-anual' })], NOW, G);
    expect(p.byProduct.get('SAVER')).toMatchObject({ grants: true, sub: { id: 'ok' } });
    const q = pickGrantingByProduct([saver({ id: 'old', billingStatus: 'CANCELED' }), saver({ id: 'ok' })], NOW, G);
    expect(q.byProduct.get('SAVER')).toMatchObject({ grants: true, sub: { id: 'ok' } });
  });
});

describe('decideReconcile por produto', () => {
  it('sem assinatura de produto novo: sem products (igual a hoje)', () => {
    const d = decideReconcile({ ...local, planSlug: null }, snap([sub()]), NOW, G);
    expect(d).toMatchObject({ kind: 'apply' });
    expect(d).not.toHaveProperty('products');
    expect(decideReconcile(local, snap([sub({ planSlug: 'x' })]), NOW, G)).toEqual({ kind: 'unknown_plan' });
    expect(decideReconcile(local, snap([sub({ billingStatus: 'REFUNDED' })]), NOW, G)).toEqual({ kind: 'suspend', advanceTo: 5n });
  });

  it('só Saver: products sem plano de Afiliados; estado local desconhecido = products_changed', () => {
    const d = decideReconcile({ ...local, planSlug: null }, snap([saver()]), NOW, G);
    expect(d).toEqual({
      kind: 'products', reasons: ['products_changed'], activate: false, advanceTo: 5n,
      products: [{ product: 'SAVER', active: true, planSlug: 'SAVER_PRO', subscriptionId: 'sv', expiresAt: new Date(FUTURE) }],
    });
  });

  it('só Saver com linha local igual: noop; tenant suspenso reativa', () => {
    const products = rows([['SAVER', { active: true, planSlug: 'SAVER_PRO', expiresAt: new Date(FUTURE) }], ['AFFILIATES', { active: false, planSlug: null, expiresAt: null }]]);
    expect(decideReconcile({ ...local, planSlug: null, products }, snap([saver()]), NOW, G)).toEqual({ kind: 'noop' });
    expect(decideReconcile({ ...local, status: 'SUSPENDED', planSlug: null, products }, snap([saver()]), NOW, G))
      .toMatchObject({ kind: 'products', reasons: ['billing_suspended'], activate: true });
    expect(decideReconcile({ ...local, status: 'SUSPENDED', adminBlocked: true, planSlug: null, products }, snap([saver()]), NOW, G))
      .toEqual({ kind: 'admin_suspended' });
  });

  it('Saver + Afiliados: apply de Afiliados como hoje, com products', () => {
    const d = decideReconcile({ ...local, planSlug: 'COPYSYNC_LITE' }, snap([sub(), saver()]), NOW, G);
    expect(d).toMatchObject({
      kind: 'apply', reasons: ['plan_changed', 'products_changed'], planSlug: 'COPYSYNC_PRO', subscriptionId: 's1',
      products: [
        { product: 'AFFILIATES', active: true, planSlug: 'COPYSYNC_PRO', subscriptionId: 's1', expiresAt: null },
        { product: 'SAVER', active: true, planSlug: 'SAVER_PRO', subscriptionId: 'sv' },
      ],
    });
  });

  it('Afiliados cortado com Saver ativo → Afiliados inativo, tenant segue (sem suspend)', () => {
    const products = rows([['SAVER', { active: true, planSlug: 'SAVER_PRO', expiresAt: new Date(FUTURE) }]]);
    const d = decideReconcile({ ...local, products }, snap([sub({ billingStatus: 'REFUNDED' }), saver()]), NOW, G);
    expect(d).toMatchObject({
      kind: 'products', reasons: ['products_changed'], activate: false,
      products: [
        { product: 'AFFILIATES', active: false, planSlug: null, subscriptionId: null },
        { product: 'SAVER', active: true, planSlug: 'SAVER_PRO' },
      ],
    });
  });

  it('plano desconhecido dando acesso + Saver ativo → Afiliados continua ativo', () => {
    const d = decideReconcile({ ...local, products: new Map() }, snap([sub({ planSlug: 'x' }), saver()]), NOW, G);
    expect(d).toMatchObject({ kind: 'products', reasons: ['products_changed'] });
    if (d.kind !== 'products') throw new Error('kind');
    expect(d.products.find((p) => p.product === 'AFFILIATES')).toEqual({ product: 'AFFILIATES', active: true, planSlug: null, subscriptionId: null, expiresAt: null });
  });

  it('plano desconhecido + Saver cortado: sem mudança local = unknown_plan; nunca reativa', () => {
    const products = rows([['SAVER', { active: false, planSlug: null, expiresAt: null }]]);
    expect(decideReconcile({ ...local, products }, snap([sub({ planSlug: 'x' }), saver({ billingStatus: 'REFUNDED' })]), NOW, G)).toEqual({ kind: 'unknown_plan' });
    expect(decideReconcile({ ...local, status: 'SUSPENDED', products: new Map() }, snap([sub({ planSlug: 'x' }), saver({ billingStatus: 'REFUNDED' })]), NOW, G))
      .toMatchObject({ kind: 'products', activate: false, reasons: ['products_changed'] });
  });

  it('nada dá acesso com Saver na lista: suspend leva products inativos', () => {
    expect(decideReconcile(local, snap([saver({ billingStatus: 'REFUNDED' })]), NOW, G)).toEqual({
      kind: 'suspend', advanceTo: 5n,
      products: [{ product: 'SAVER', active: false, planSlug: null, subscriptionId: null, expiresAt: null }],
    });
  });

  it('stale vence tudo', () => {
    expect(decideReconcile({ ...local, lastBillingEventSeq: 9n }, snap([saver()]), NOW, G)).toEqual({ kind: 'stale' });
  });
});
