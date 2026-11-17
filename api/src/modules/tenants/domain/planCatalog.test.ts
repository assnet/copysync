import { describe, expect, it } from 'vitest';
import { ALL_PLAN_SLUGS, isKnownPlanSlug, productOfPlanSlug, resolvePlan } from './planCatalog';
import { PLAN_SLUGS, SAVER_PLAN_SLUGS, resolveEffectivePlanSlug } from './planPresets';

/** Mesmos casos da caracterização de `planPresets.test.ts`. */
const AFFILIATE_CASES: Array<[string | null | undefined, string[] | null | undefined]> = [
  ['afiliado-dev-anual', []], ['copysync-dev-anual', null], [' AFILIADO-DEV-ANUAL ', undefined],
  ...(['lite', 'pro', 'max'] as const).flatMap((t) => [[`copysync-${t}-mensal`, []], [`copysync-${t}-anual`, []]] as Array<[string, string[]]>),
  ['COPYSYNC_PRO', []], ['COPYSYNC-MAX-ANUAL', []],
  ['copysync-pro-mensal', ['COPYSYNC_PRO']], ['copysync-lite-mensal', ['COPYSYNC_MAX']], ['copysync-max-anual', ['COPYSYNC_LITE']],
  ['copysync-lite-mensal', ['COPYSYNC_PRO', 'COPYSYNC_LITE']], [null, ['COPYSYNC_MAX', 'COPYSYNC_PRO']],
  ['copysync-lite-mensal', ['OUTRA_APP_VIP', 'COPYSYNC_PRO', 'copysync_max']], ['copysync-pro-anual', ['OUTRA_APP_VIP']],
  ['plano-x', [' COPYSYNC_LITE ']], ['copysync-lite-mensal', ['SAVER_MAX']], ['copysync-dev-anual', ['COPYSYNC_LITE']],
];

describe('resolvePlan', () => {
  it.each(AFFILIATE_CASES)('Afiliados igual a hoje: %j %j', (slug, perms) => {
    expect(resolvePlan(slug, perms)).toEqual({ product: 'AFFILIATES', planSlug: resolveEffectivePlanSlug(slug, perms) });
  });

  it('desconhecido continua null', () => {
    for (const raw of ['starter', 'copysync-starter-mensal', 'copysync-pro-semestral', 'gold', '', null, undefined]) {
      expect(resolvePlan(raw, [])).toBeNull();
    }
    expect(resolvePlan('plano-x', ['X', 'saver_pro'])).toBeNull();
    expect(resolvePlan('copysync-saver-gold-mensal', [])).toBeNull();
  });

  it('Saver pelo slug da oferta (mensal = anual), pelo interno e pela permissão', () => {
    for (const tier of ['lite', 'pro', 'max'] as const) {
      const planSlug = `SAVER_${tier.toUpperCase()}`;
      expect(resolvePlan(`copysync-saver-${tier}-mensal`, [])).toEqual({ product: 'SAVER', planSlug });
      expect(resolvePlan(` COPYSYNC-SAVER-${tier.toUpperCase()}-ANUAL `, null)).toEqual({ product: 'SAVER', planSlug });
      expect(resolvePlan(planSlug, undefined)).toEqual({ product: 'SAVER', planSlug });
      expect(resolvePlan(null, [planSlug])).toEqual({ product: 'SAVER', planSlug });
    }
  });

  it('Saver: permissão vence o slug e a mais alta vence', () => {
    expect(resolvePlan('copysync-saver-lite-mensal', ['SAVER_PRO'])).toEqual({ product: 'SAVER', planSlug: 'SAVER_PRO' });
    expect(resolvePlan('x', ['SAVER_PRO', 'OUTRA', 'SAVER_MAX'])).toEqual({ product: 'SAVER', planSlug: 'SAVER_MAX' });
  });

  it('permissão de Afiliados vence slug do Saver (Afiliados é testado primeiro)', () => {
    expect(resolvePlan('copysync-saver-max-anual', ['COPYSYNC_LITE'])).toEqual({ product: 'AFFILIATES', planSlug: 'COPYSYNC_LITE' });
  });
});

describe('ALL_PLAN_SLUGS', () => {
  it('Afiliados ∪ Saver, sem alterar PLAN_SLUGS', () => {
    expect(PLAN_SLUGS).toEqual(['COPYSYNC_LITE', 'COPYSYNC_PRO', 'COPYSYNC_MAX']);
    expect(ALL_PLAN_SLUGS).toEqual([...PLAN_SLUGS, ...SAVER_PLAN_SLUGS]);
    expect(isKnownPlanSlug('SAVER_PRO')).toBe(true);
    expect(isKnownPlanSlug('copysync-saver-pro-mensal')).toBe(false);
  });

  it('productOfPlanSlug', () => {
    expect(productOfPlanSlug('COPYSYNC_MAX')).toBe('AFFILIATES');
    expect(productOfPlanSlug('SAVER_LITE')).toBe('SAVER');
    expect(productOfPlanSlug('X')).toBeNull();
  });
});
