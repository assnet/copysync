import { describe, expect, it } from 'vitest';
import { SAVER_PLAN_CATALOG, saverAnnualTotal, saverCheckoutPath, saverPlanBySlug, saverPriceFor } from './catalog';
import { saverPlansStrings as t } from './strings';

describe('catálogo do Saver (vitrine)', () => {
  it('três planos, um recomendado', () => {
    expect(SAVER_PLAN_CATALOG.map((p) => p.name)).toEqual(['LITE', 'PRO', 'MAX']);
    expect(SAVER_PLAN_CATALOG.filter((p) => p.recommended)).toHaveLength(1);
  });

  it('preços do design §2.1: mensal, anual por mês e total do ano', () => {
    expect(SAVER_PLAN_CATALOG.map((p) => saverPriceFor(p, 'monthly'))).toEqual([29.9, 39.9, 49.9]);
    expect(SAVER_PLAN_CATALOG.map((p) => saverPriceFor(p, 'annual'))).toEqual([23.9, 32.9, 39.9]);
    expect(SAVER_PLAN_CATALOG.map(saverAnnualTotal)).toEqual([286.8, 394.8, 478.8]);
  });

  it('limites iguais a SAVER_PLAN_PRESETS em api/src/modules/tenants/domain/planPresets.ts', () => {
    const bySlug = Object.fromEntries(SAVER_PLAN_CATALOG.map((p) => [p.planSlug, {
      saver_groups: p.limits.groups,
      saver_contacts: p.limits.contacts,
      saver_group_scans_per_day: p.limits.groupScansPerDay,
      saver_auto_refresh_enabled: p.limits.autoRefresh,
      whatsapp_sessions: p.limits.whatsappSessions,
    }]));
    expect(bySlug).toEqual({
      SAVER_LITE: { saver_groups: 10, saver_contacts: 10_000, saver_group_scans_per_day: 20, saver_auto_refresh_enabled: false, whatsapp_sessions: 1 },
      SAVER_PRO: { saver_groups: 50, saver_contacts: 50_000, saver_group_scans_per_day: 100, saver_auto_refresh_enabled: true, whatsapp_sessions: 1 },
      SAVER_MAX: { saver_groups: null, saver_contacts: null, saver_group_scans_per_day: 500, saver_auto_refresh_enabled: true, whatsapp_sessions: 2 },
    });
  });

  it('acha o plano atual pelo slug da API', () => {
    expect(saverPlanBySlug('SAVER_PRO')?.tier).toBe('pro');
    expect(saverPlanBySlug('COPYSYNC_PRO')).toBeUndefined();
    expect(saverPlanBySlug(null)).toBeUndefined();
  });

  it('texto não promete nome nem número de todo membro e diz o limite do número oculto', () => {
    const all = JSON.stringify(t).toLowerCase();
    expect(all).not.toMatch(/todos os (números|nomes|contatos)|todo membro|100%|copysync|waio/);
    expect(t.hiddenNumber.body.toLowerCase()).toContain('escondem o número');
  });
});

describe('saverCheckoutPath', () => {
  it('monta o slug do link de redirecionamento por plano e período', () => {
    expect(saverCheckoutPath('lite', 'monthly')).toBe('/redirect/saver-lite-mensal');
    expect(saverCheckoutPath('max', 'annual')).toBe('/redirect/saver-max-anual');
  });
});
