import { describe, expect, it } from 'vitest';
import type { SubscriptionLimitItem, SubscriptionResponse } from '@/types/api.types';
import { limitsForProduct, productLabel, productOfLimit, subscriptionChannels, subscriptionProductCards } from './productLimits';

const lim = (key: string, product?: string | null): SubscriptionLimitItem =>
  ({ key, channel: null, kind: 'count', used: 0, limit: 1, enabled: true, ...(product !== undefined ? { product } : {}) });
const sub = (over: Partial<SubscriptionResponse> = {}): SubscriptionResponse =>
  ({ tenantName: 'Loja', planSlug: 'pro', status: 'ACTIVE', suspendedAt: null, expiresAt: null, limits: [], ...over });

describe('productLimits', () => {
  it('produto da chave: campo da API vence; sem campo, pela chave', () => {
    expect(productOfLimit(lim('saver_groups', 'SAVER'))).toBe('SAVER');
    expect(productOfLimit(lim('whatsapp_sessions', null))).toBeNull();
    expect(productOfLimit(lim('whatsapp_sessions'))).toBeNull();
    expect(productOfLimit(lim('storefront_enabled'))).toBe('AFFILIATES');
    expect(productOfLimit(lim('saver_contacts'))).toBe('SAVER');
  });

  it('API antiga ou lista vazia = um cartão de Afiliados com os campos do topo', () => {
    expect(subscriptionProductCards(sub())).toEqual([
      { product: 'AFFILIATES', item: { product: 'AFFILIATES', planSlug: null, tier: 'pro', expiresAt: null, source: null } },
    ]);
    expect(subscriptionProductCards(sub({ products: [] }))).toHaveLength(1);
  });

  it('cartões na ordem da API, sem CHAT nem produto desconhecido', () => {
    const cards = subscriptionProductCards(sub({
      products: [
        { product: 'AFFILIATES', planSlug: 'COPYSYNC_PRO', tier: 'pro', expiresAt: null, source: null },
        { product: 'CHAT', planSlug: null, tier: null, expiresAt: null, source: null },
        { product: 'X', planSlug: null, tier: null, expiresAt: null, source: null },
        { product: 'SAVER', planSlug: 'SAVER_MAX', tier: 'max', expiresAt: null, source: 'ADMIN' },
      ],
    }));
    expect(cards.map((c) => c.product)).toEqual(['AFFILIATES', 'SAVER']);
  });

  it('limites por produto; compartilhados só quando pedido', () => {
    const all = [lim('whatsapp_sessions', null), lim('storefront_enabled', 'AFFILIATES'), lim('saver_groups', 'SAVER')];
    expect(limitsForProduct(all, 'AFFILIATES', true).map((l) => l.key)).toEqual(['whatsapp_sessions', 'storefront_enabled']);
    expect(limitsForProduct(all, 'SAVER', false).map((l) => l.key)).toEqual(['saver_groups']);
    expect(limitsForProduct(all, 'SAVER', true).map((l) => l.key)).toEqual(['whatsapp_sessions', 'saver_groups']);
  });

  it('rótulo do produto', () => {
    expect(productLabel('SAVER')).toBe('Saver');
    expect(productLabel('AFFILIATES')).toBe('Afiliados');
  });

  it('canais: Telegram só com produto que usa Telegram (Saver é só WhatsApp)', () => {
    const card = (product: 'AFFILIATES' | 'SAVER') => ({ product, item: { product, planSlug: null, tier: null, expiresAt: null, source: null } });
    expect(subscriptionChannels([card('SAVER')])).toEqual(['whatsapp']);
    expect(subscriptionChannels([card('AFFILIATES'), card('SAVER')])).toEqual(['whatsapp', 'telegram']);
    expect(subscriptionChannels([card('AFFILIATES')])).toEqual(['whatsapp', 'telegram']);
  });
});
