import { describe, expect, it } from 'vitest';
import { toPanelPlanSlug, toPanelPlanSlugs } from './planSlug';

describe('toPanelPlanSlug', () => {
  it('aceita slug do domínio e id curto', () => {
    expect(toPanelPlanSlug('COPYSYNC_LITE')).toBe('lite');
    expect(toPanelPlanSlug('COPYSYNC_PRO')).toBe('pro');
    expect(toPanelPlanSlug('COPYSYNC_MAX')).toBe('max');
    expect(toPanelPlanSlug('max')).toBe('max');
  });

  it('desconhecido e chaves do protótipo viram null', () => {
    expect(toPanelPlanSlug('ENTERPRISE')).toBeNull();
    expect(toPanelPlanSlug('')).toBeNull();
    for (const k of ['toString', '__proto__', 'constructor', 'hasOwnProperty']) {
      expect(toPanelPlanSlug(k)).toBeNull();
    }
  });
});

describe('toPanelPlanSlugs', () => {
  it('converte, remove desconhecidos e repetidos, mantendo a ordem', () => {
    expect(toPanelPlanSlugs(['COPYSYNC_PRO', 'pro', 'toString', 'COPYSYNC_MAX', 'x'])).toEqual(['pro', 'max']);
    expect(toPanelPlanSlugs([])).toEqual([]);
  });
});
