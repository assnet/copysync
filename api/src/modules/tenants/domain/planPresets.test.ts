import { describe, expect, it } from 'vitest';
import { PLAN_PRESETS, PLAN_SLUGS, SAVER_PLAN_PRESETS, SAVER_PLAN_SLUGS, planPresetRows, presetOf, resolveEffectivePlanSlug, resolvePlanSlug } from './planPresets';
import { ALL_PLAN_SLUGS, resolvePlan } from './planCatalog';
import { ADMIN_EDITABLE_ENTITLEMENT_KEYS } from './adminEditableEntitlements';
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
    // Kabum, Magalu e AliExpress só no MAX por preset, com `false` explícito nos outros dois
    for (const key of [K.MARKETPLACE_KABUM_ENABLED, K.MARKETPLACE_MAGALU_ENABLED, K.MARKETPLACE_ALIEXPRESS_ENABLED]) {
      expect(rows.filter((r) => r.key === key).map((r) => [r.planSlug, r.value])).toEqual([
        ['COPYSYNC_LITE', false],
        ['COPYSYNC_PRO', false],
        ['COPYSYNC_MAX', true],
      ]);
    }
    // Foto oficial no PRO e MAX; marca d'água própria só no MAX (false explícito onde não libera)
    expect(rows.filter((r) => r.key === K.OFFER_CLEAN_IMAGE_ENABLED).map((r) => [r.planSlug, r.value])).toEqual([
      ['COPYSYNC_LITE', false],
      ['COPYSYNC_PRO', true],
      ['COPYSYNC_MAX', true],
    ]);
    expect(rows.filter((r) => r.key === K.OFFER_WATERMARK_ENABLED).map((r) => [r.planSlug, r.value])).toEqual([
      ['COPYSYNC_LITE', false],
      ['COPYSYNC_PRO', false],
      ['COPYSYNC_MAX', true],
    ]);
    // Caçador de Ofertas só no MAX (10 achados/dia), com false/0 explícitos nos outros dois
    expect(rows.filter((r) => r.key === K.OFFER_HUNTER_ENABLED).map((r) => [r.planSlug, r.value])).toEqual([
      ['COPYSYNC_LITE', false],
      ['COPYSYNC_PRO', false],
      ['COPYSYNC_MAX', true],
    ]);
    expect(rows.filter((r) => r.key === K.OFFER_HUNTER_FINDS_PER_DAY).map((r) => [r.planSlug, r.value])).toEqual([
      ['COPYSYNC_LITE', 0],
      ['COPYSYNC_PRO', 0],
      ['COPYSYNC_MAX', 10],
    ]);
    // 3 de Afiliados + 3 do Saver
    expect(new Set(rows.map((r) => r.planSlug)).size).toBe(6);
  });

  it('gerações de oferta por dia: LITE 5, PRO 20, MAX ilimitado (null explícito, não ausente)', () => {
    const rows = planPresetRows().filter((r) => r.key === K.OFFER_GENERATIONS_PER_DAY);
    expect(rows.map((r) => [r.planSlug, r.value])).toEqual([
      ['COPYSYNC_LITE', 5],
      ['COPYSYNC_PRO', 20],
      ['COPYSYNC_MAX', null],
    ]);
  });

  it('etiquetas do Mercado Livre: LITE 1, PRO 2, MAX 10 (principal incluída)', () => {
    const rows = planPresetRows().filter((r) => r.key === K.MERCADO_LIVRE_AFFILIATE_TAGS);
    expect(rows.map((r) => [r.planSlug, r.value])).toEqual([
      ['COPYSYNC_LITE', 1],
      ['COPYSYNC_PRO', 2],
      ['COPYSYNC_MAX', 10],
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

describe('resolveEffectivePlanSlug', () => {
  it('permissão do próprio nível = mesmo resultado do slug', () => {
    expect(resolveEffectivePlanSlug('copysync-pro-mensal', ['COPYSYNC_PRO'])).toBe('COPYSYNC_PRO');
  });
  it('permissão mais alta vence o slug', () => {
    expect(resolveEffectivePlanSlug('copysync-lite-mensal', ['COPYSYNC_MAX'])).toBe('COPYSYNC_MAX');
  });
  it('permissão mais baixa também vence o slug', () => {
    expect(resolveEffectivePlanSlug('copysync-max-anual', ['COPYSYNC_LITE'])).toBe('COPYSYNC_LITE');
  });
  it('várias reconhecidas: a mais alta vence, sem depender da ordem', () => {
    expect(resolveEffectivePlanSlug('copysync-lite-mensal', ['COPYSYNC_PRO', 'COPYSYNC_LITE'])).toBe('COPYSYNC_PRO');
    expect(resolveEffectivePlanSlug(null, ['COPYSYNC_MAX', 'COPYSYNC_PRO'])).toBe('COPYSYNC_MAX');
  });
  it('desconhecida é ignorada ao lado de uma reconhecida', () => {
    expect(resolveEffectivePlanSlug('copysync-lite-mensal', ['OUTRA_APP_VIP', 'COPYSYNC_PRO', 'copysync_max'])).toBe('COPYSYNC_PRO');
  });
  it('nenhuma reconhecida cai no slug', () => {
    expect(resolveEffectivePlanSlug('copysync-pro-anual', ['OUTRA_APP_VIP'])).toBe('COPYSYNC_PRO');
    expect(resolveEffectivePlanSlug('afiliado-dev-anual', [])).toBe('COPYSYNC_MAX');
    expect(resolveEffectivePlanSlug('copysync-lite-mensal', null)).toBe('COPYSYNC_LITE');
    expect(resolveEffectivePlanSlug('copysync-lite-mensal', undefined)).toBe('COPYSYNC_LITE');
  });
  it('sem permissão reconhecida e slug desconhecido = null', () => {
    expect(resolveEffectivePlanSlug('plano-x', ['X'])).toBeNull();
    expect(resolveEffectivePlanSlug(null, null)).toBeNull();
  });
  it('permissão reconhecida resolve mesmo com slug desconhecido', () => {
    expect(resolveEffectivePlanSlug('plano-x', [' COPYSYNC_LITE '])).toBe('COPYSYNC_LITE');
  });
  it('caracterização: slug de outro produto não resolve; permissão de outro produto é ignorada', () => {
    expect(resolvePlanSlug('copysync-saver-pro-mensal')).toBeNull();
    expect(resolveEffectivePlanSlug('copysync-lite-mensal', ['SAVER_MAX'])).toBe('COPYSYNC_LITE');
    expect(resolveEffectivePlanSlug(null, ['SAVER_PRO'])).toBeNull();
    expect(resolveEffectivePlanSlug('copysync-saver-max-anual', ['SAVER_MAX'])).toBeNull();
  });
  it('caracterização: oferta DEV com permissão menor = permissão vence', () => {
    expect(resolveEffectivePlanSlug('copysync-dev-anual', ['COPYSYNC_LITE'])).toBe('COPYSYNC_LITE');
  });
});

/** Tabela de `.specs/features/saver/design.md` §2.1 (roadmap). `null` = ilimitado explícito. */
const SAVER_TABLE = {
  SAVER_LITE: { groups: 10, contacts: 10_000, scans: 20, autoRefresh: false, whatsapp: 1, telegram: 0 },
  SAVER_PRO: { groups: 50, contacts: 50_000, scans: 100, autoRefresh: true, whatsapp: 1, telegram: 0 },
  SAVER_MAX: { groups: null, contacts: null, scans: 500, autoRefresh: true, whatsapp: 2, telegram: 0 },
} as const;

describe('SAVER_PLAN_PRESETS', () => {
  it.each(SAVER_PLAN_SLUGS)('%s bate com a tabela (e só tem essas chaves)', (slug) => {
    const t = SAVER_TABLE[slug];
    expect(SAVER_PLAN_PRESETS[slug]).toEqual({
      [K.SAVER_GROUPS]: t.groups,
      [K.SAVER_CONTACTS]: t.contacts,
      [K.SAVER_GROUP_SCANS_PER_DAY]: t.scans,
      [K.SAVER_AUTO_REFRESH_ENABLED]: t.autoRefresh,
      [K.WHATSAPP_SESSIONS]: t.whatsapp,
      [K.TELEGRAM_SESSIONS]: t.telegram,
    });
  });

  it('nomes das chaves', () => {
    expect([K.SAVER_GROUPS, K.SAVER_GROUP_SCANS_PER_DAY, K.SAVER_CONTACTS, K.SAVER_AUTO_REFRESH_ENABLED])
      .toEqual(['saver_groups', 'saver_group_scans_per_day', 'saver_contacts', 'saver_auto_refresh_enabled']);
  });

  it('MAX grava null explícito em grupos e contatos (omitir valeria zero no Saver)', () => {
    const max = planPresetRows().filter((r) => r.planSlug === 'SAVER_MAX');
    for (const key of [K.SAVER_GROUPS, K.SAVER_CONTACTS]) {
      expect(max.find((r) => r.key === key)).toEqual({ planSlug: 'SAVER_MAX', key, value: null });
    }
  });

  it('telegram_sessions 0 em todos; whatsapp_sessions 1/1/2', () => {
    const rows = planPresetRows().filter((r) => r.planSlug.startsWith('SAVER_'));
    expect(rows.filter((r) => r.key === K.TELEGRAM_SESSIONS).map((r) => [r.planSlug, r.value]))
      .toEqual([['SAVER_LITE', 0], ['SAVER_PRO', 0], ['SAVER_MAX', 0]]);
    expect(rows.filter((r) => r.key === K.WHATSAPP_SESSIONS).map((r) => [r.planSlug, r.value]))
      .toEqual([['SAVER_LITE', 1], ['SAVER_PRO', 1], ['SAVER_MAX', 2]]);
  });

  it('slugs Saver em ALL_PLAN_SLUGS e fora de PLAN_SLUGS; nenhuma chave saver_* editável pelo admin', () => {
    for (const slug of SAVER_PLAN_SLUGS) {
      expect(ALL_PLAN_SLUGS).toContain(slug);
      expect(PLAN_SLUGS as readonly string[]).not.toContain(slug);
    }
    expect(ADMIN_EDITABLE_ENTITLEMENT_KEYS.filter((k) => k.startsWith('saver_'))).toEqual([]);
  });

  it('copysync-saver-{tier}-{mensal|anual} resolve produto SAVER; só permissão SAVER_PRO também', () => {
    for (const tier of ['lite', 'pro', 'max'] as const) {
      for (const period of ['mensal', 'anual']) {
        expect(resolvePlan(`copysync-saver-${tier}-${period}`, [])).toEqual({ product: 'SAVER', planSlug: `SAVER_${tier.toUpperCase()}` });
      }
    }
    expect(resolvePlan(null, ['SAVER_PRO'])).toEqual({ product: 'SAVER', planSlug: 'SAVER_PRO' });
  });

  it('presetOf cobre os dois produtos', () => {
    expect(presetOf('SAVER_PRO')).toBe(SAVER_PLAN_PRESETS.SAVER_PRO);
    expect(presetOf('COPYSYNC_LITE')).toBe(PLAN_PRESETS.COPYSYNC_LITE);
    expect(presetOf('X')).toBeUndefined();
  });
});
