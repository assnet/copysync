import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type EligibilitySnapshot,
  INTERNAL_ONLY_FEATURES,
  eligibleTenantsByFeature,
  entitlementAllows,
  entitlementKeysOf,
  isEligible,
} from './featureEligibility';
import { FEATURE_USAGE_CATALOG, findFeature } from './featureUsageCatalog';

const snap = (over: Partial<EligibilitySnapshot> = {}): EligibilitySnapshot => ({
  tenantId: 't',
  planSlug: 'COPYSYNC_MAX',
  products: {},
  entitlements: {},
  ...over,
});
const f = (key: string) => findFeature(key)!;

describe('direito ao recurso', () => {
  it('conta legado sem linha de produto: Afiliados e chat (conta interna) sim, Saver não', () => {
    expect(isEligible(snap(), f('offer_generator'))).toBe(true);
    expect(isEligible(snap({ internal: true }), f('chat_send'))).toBe(true);
    expect(isEligible(snap(), f('saver_extraction'))).toBe(false);
  });

  it('chat segue a linha de Afiliados', () => {
    const off = snap({ internal: true, products: { AFFILIATES: { status: 'INACTIVE', planSlug: null } } });
    expect(isEligible(off, f('chat_send'))).toBe(false);
    expect(isEligible(off, f('offer_generator'))).toBe(false);
    // Linha CHAT (não deveria existir) não muda nada: vale a fonte
    const odd = snap({ internal: true, products: { AFFILIATES: { status: 'INACTIVE', planSlug: null }, CHAT: { status: 'ACTIVE', planSlug: null } } });
    expect(isEligible(odd, f('chat_send'))).toBe(false);
  });

  it('Saver pela linha SAVER ativa', () => {
    expect(isEligible(snap({ products: { SAVER: { status: 'ACTIVE', planSlug: 'SAVER_LITE' } } }), f('saver_export'))).toBe(true);
    expect(isEligible(snap({ products: { SAVER: { status: 'INACTIVE', planSlug: 'SAVER_LITE' } } }), f('saver_export'))).toBe(false);
  });

  it('entitlement gravado vence o preset; ausente cai no preset do plano', () => {
    expect(isEligible(snap({ entitlements: { storefront_enabled: false } }), f('storefront'))).toBe(false);
    expect(isEligible(snap({ planSlug: 'COPYSYNC_LITE', entitlements: { storefront_enabled: true } }), f('storefront'))).toBe(true);
    expect(isEligible(snap({ planSlug: 'COPYSYNC_PRO' }), f('storefront'))).toBe(true);
    expect(isEligible(snap({ planSlug: 'COPYSYNC_PRO' }), f('offer_story'))).toBe(false);
    expect(isEligible(snap({ planSlug: null }), f('storefront'))).toBe(false);
    expect(isEligible(snap({ planSlug: 'desconhecido' }), f('offer_hunter'))).toBe(false);
  });

  it('cada chave lê como o recurso lê', () => {
    expect(entitlementAllows('storefront_enabled', 'true')).toBe(true);
    expect(entitlementAllows('storefront_enabled', undefined)).toBe(false);
    expect(entitlementAllows('ai_rewrite_enabled', undefined)).toBe(true);
    expect(entitlementAllows('ai_rewrite_enabled', false)).toBe(false);
    expect(entitlementAllows('telegram_sessions', undefined)).toBe(true);
    expect(entitlementAllows('telegram_sessions', null)).toBe(true);
    expect(entitlementAllows('telegram_sessions', 0)).toBe(false);
    expect(entitlementAllows('telegram_sessions', '2')).toBe(true);
  });

  it('chat só para conta interna enquanto o menu do Chat for só de super admin', () => {
    expect(isEligible(snap(), f('chat_send'))).toBe(false);
    expect(isEligible(snap({ internal: true }), f('chat_send'))).toBe(true);
    // Amarração com o menu do painel pelo contrato: o teste do menu (app) confere o `superAdminOnly` do Chat
    const contract = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../../../contracts/feature-usage/catalog.json'), 'utf8'),
    ) as { internalOnlyFeatures: string[] };
    expect([...INTERNAL_ONLY_FEATURES].sort()).toEqual([...contract.internalOnlyFeatures].sort());
  });

  it('audiência "Só super admin": conta comum fora, conta interna dentro; liberada = todo tenant com direito', () => {
    const saver = { products: { SAVER: { status: 'ACTIVE' as const, planSlug: 'SAVER_LITE' } } };
    const onlyAdmin = { offer_hunter_enabled: true, saver: true };
    expect(isEligible(snap(), f('offer_hunter'), onlyAdmin)).toBe(false);
    expect(isEligible(snap({ internal: true }), f('offer_hunter'), onlyAdmin)).toBe(true);
    expect(isEligible(snap(saver), f('saver_export'), onlyAdmin)).toBe(false);
    expect(isEligible(snap({ ...saver, internal: true }), f('saver_extraction'), onlyAdmin)).toBe(true);
    const open = { offer_hunter_enabled: false, saver: false };
    expect(isEligible(snap(), f('offer_hunter'), open)).toBe(true);
    expect(isEligible(snap(saver), f('saver_export'), open)).toBe(true);
    // A audiência de um não vale para o outro nem para recurso sem audiência
    expect(isEligible(snap(), f('offer_hunter'), { saver: true })).toBe(true);
    expect(isEligible(snap(), f('storefront'), onlyAdmin)).toBe(true);
  });

  it('Caçador exige também offer_hunter_finds_per_day > 0 (ausente = 0)', () => {
    expect(isEligible(snap({ entitlements: { offer_hunter_enabled: true, offer_hunter_finds_per_day: 0 } }), f('offer_hunter'))).toBe(false);
    expect(isEligible(snap({ planSlug: 'COPYSYNC_LITE', entitlements: { offer_hunter_enabled: true } }), f('offer_hunter'))).toBe(false);
    expect(isEligible(snap({ planSlug: null, entitlements: { offer_hunter_enabled: true } }), f('offer_hunter'))).toBe(false);
    expect(isEligible(snap({ planSlug: null, entitlements: { offer_hunter_enabled: true, offer_hunter_finds_per_day: '3' } }), f('offer_hunter'))).toBe(true);
    // MAX: preset com flag e teto 10
    expect(isEligible(snap(), f('offer_hunter'))).toBe(true);
    expect(entitlementAllows('offer_hunter_finds_per_day', null)).toBe(false);
  });

  it('sessão é da conta: sem produto exigido', () => {
    const none = snap({ planSlug: null, products: { AFFILIATES: { status: 'INACTIVE', planSlug: null } } });
    expect(isEligible(none, f('whatsapp_session'))).toBe(true);
    expect(isEligible(none, f('panel_login'))).toBe(true);
  });

  it('lote: um conjunto por recurso pedido', () => {
    const out = eligibleTenantsByFeature(
      [snap({ tenantId: 'a' }), snap({ tenantId: 'b', planSlug: 'COPYSYNC_LITE' })],
      [f('storefront'), f('offer_generator')],
    );
    expect([...out.keys()]).toEqual(['storefront', 'offer_generator']);
    expect([...out.get('storefront')!]).toEqual(['a']);
    expect([...out.get('offer_generator')!]).toEqual(['a', 'b']);
  });

  it('chaves pedidas ao banco: só as dos recursos', () => {
    expect(entitlementKeysOf(FEATURE_USAGE_CATALOG)).toEqual(
      ['ai_rewrite_enabled', 'offer_hunter_enabled', 'offer_hunter_finds_per_day', 'offer_story_enabled', 'storefront_enabled', 'telegram_sessions'],
    );
    expect(entitlementKeysOf([f('offer_generator')])).toEqual([]);
  });

  it('reusa a regra de acesso de tenants (não reescreve)', () => {
    const src = readFileSync(resolve(__dirname, 'featureEligibility.ts'), 'utf8');
    expect(src).toMatch(/resolveProductAccess\(/);
    expect(src).toMatch(/accessSourceOf\(/);
    expect(src).not.toMatch(/@prisma|fastify/i);
  });
});
