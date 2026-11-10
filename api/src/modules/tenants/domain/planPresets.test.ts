import { describe, expect, it } from 'vitest';
import { PLAN_PRESETS, planPresetRows, resolvePlanSlug } from './planPresets';
import { ENTITLEMENT_KEYS as K } from './entitlementKeys';

/** Mesmos números da vitrine (`app/src/features/plans/catalog.ts` → `limits`) e do roadmap. Mudou lá, muda aqui. */
const CATALOG_LIMITS = {
  COPYSYNC_LITE: { storefront: false, offerStory: false, whatsappSessions: 1, telegramSessions: 0, monitoredGroups: 1, broadcastGroups: 5, telegramMonitoredGroups: 0, telegramBroadcastGroups: 0, mentionAll: false, crossSession: false, linkRotations: 1, linkRotationGroups: 3, telegramLinkRotations: 0, telegramLinkRotationGroups: 0 },
  COPYSYNC_PRO: { storefront: true, offerStory: false, whatsappSessions: 1, telegramSessions: 1, monitoredGroups: 2, broadcastGroups: 10, telegramMonitoredGroups: 2, telegramBroadcastGroups: 10, mentionAll: true, crossSession: false, linkRotations: 1, linkRotationGroups: 5, telegramLinkRotations: 1, telegramLinkRotationGroups: 5 },
  COPYSYNC_MAX: { storefront: true, offerStory: true, whatsappSessions: 2, telegramSessions: 2, monitoredGroups: 6, broadcastGroups: 40, telegramMonitoredGroups: 6, telegramBroadcastGroups: 40, mentionAll: true, crossSession: true, linkRotations: 2, linkRotationGroups: 10, telegramLinkRotations: 2, telegramLinkRotationGroups: 10 },
} as const;

describe('PLAN_PRESETS', () => {
  it.each(Object.keys(CATALOG_LIMITS) as (keyof typeof CATALOG_LIMITS)[])('%s bate com a vitrine', (slug) => {
    const c = CATALOG_LIMITS[slug];
    expect(PLAN_PRESETS[slug]).toMatchObject({
      [K.WHATSAPP_SESSIONS]: c.whatsappSessions,
      [K.TELEGRAM_SESSIONS]: c.telegramSessions,
      [K.MONITORED_GROUPS]: c.monitoredGroups,
      [K.BROADCAST_GROUPS]: c.broadcastGroups,
      [K.TELEGRAM_MONITORED_GROUPS]: c.telegramMonitoredGroups,
      [K.TELEGRAM_BROADCAST_GROUPS]: c.telegramBroadcastGroups,
      [K.MENTION_ALL_ENABLED]: c.mentionAll,
      [K.CROSS_SESSION_DISPATCH]: c.crossSession,
      [K.LINK_ROTATIONS]: c.linkRotations,
      [K.LINK_ROTATION_GROUPS]: c.linkRotationGroups,
      [K.TELEGRAM_LINK_ROTATIONS]: c.telegramLinkRotations,
      [K.TELEGRAM_LINK_ROTATION_GROUPS]: c.telegramLinkRotationGroups,
      [K.STOREFRONT_ENABLED]: c.storefront,
      [K.OFFER_STORY_ENABLED]: c.offerStory,
    });
  });

  it('sessão cruzada só no Business; linhas do seed cobrem todos os planos', () => {
    const rows = planPresetRows();
    const cross = rows.filter((r) => r.key === K.CROSS_SESSION_DISPATCH && r.value === true).map((r) => r.planSlug);
    expect(cross).toEqual(['COPYSYNC_MAX']);
    // booleano de verdade (JSON boolean na coluna), e `false` explícito no Starter: ausência não desliga rebaixado
    const store = rows.filter((r) => r.key === K.STOREFRONT_ENABLED);
    expect(store.map((r) => [r.planSlug, r.value])).toEqual([
      ['COPYSYNC_LITE', false],
      ['COPYSYNC_PRO', true],
      ['COPYSYNC_MAX', true],
    ]);
    // Story de Oferta só no Business, com `false` explícito nos outros dois
    expect(rows.filter((r) => r.key === K.OFFER_STORY_ENABLED).map((r) => [r.planSlug, r.value])).toEqual([
      ['COPYSYNC_LITE', false],
      ['COPYSYNC_PRO', false],
      ['COPYSYNC_MAX', true],
    ]);
    // Shein só no MAX por preset, com `false` explícito nos outros dois (super admin pode liberar)
    expect(rows.filter((r) => r.key === K.MARKETPLACE_SHEIN_ENABLED).map((r) => [r.planSlug, r.value])).toEqual([
      ['COPYSYNC_LITE', false],
      ['COPYSYNC_PRO', false],
      ['COPYSYNC_MAX', true],
    ]);
    expect(new Set(rows.map((r) => r.planSlug)).size).toBe(3);
  });

  it('gerações de oferta por dia: LITE 5, PRO 20, MAX ilimitado (null explícito, não ausente)', () => {
    const rows = planPresetRows().filter((r) => r.key === K.OFFER_GENERATIONS_PER_DAY);
    expect(rows.map((r) => [r.planSlug, r.value])).toEqual([
      ['COPYSYNC_LITE', 5],
      ['COPYSYNC_PRO', 20],
      ['COPYSYNC_MAX', null],
    ]);
  });
});

describe('resolvePlanSlug', () => {
  it.each(['afiliado-dev-anual', 'copysync-dev-anual', ' AFILIADO-DEV-ANUAL '])('oferta DEV %s resolve Business', (slug) => {
    expect(resolvePlanSlug(slug)).toBe('COPYSYNC_MAX');
  });

  it('6 slugs de oferta da central resolvem o tier (mensal = anual)', () => {
    for (const [tier, slug] of [['lite', 'COPYSYNC_LITE'], ['pro', 'COPYSYNC_PRO'], ['max', 'COPYSYNC_MAX']] as const) {
      expect(resolvePlanSlug(`copysync-${tier}-mensal`)).toBe(slug);
      expect(resolvePlanSlug(`copysync-${tier}-anual`)).toBe(slug);
    }
  });

  it('aceita o slug interno e rejeita desconhecido/antigo da vitrine', () => {
    expect(resolvePlanSlug('COPYSYNC_PRO')).toBe('COPYSYNC_PRO');
    expect(resolvePlanSlug('COPYSYNC-MAX-ANUAL')).toBe('COPYSYNC_MAX');
    for (const raw of ['starter', 'copysync-starter-mensal', 'copysync-pro-semestral', 'afiliado-dev-mensal', 'copysync-dev', 'copysync-dev-anual-extra', 'gold', '', null, undefined]) {
      expect(resolvePlanSlug(raw)).toBeNull();
    }
  });
});
