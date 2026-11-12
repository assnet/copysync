import { describe, expect, it } from 'vitest';
import { HUNT_PRESETS, huntPreset } from './huntPresets';
import { HUNT_COMMISSION_BANDS, HUNT_SORTS } from '../../hunter/HuntCandidate';

describe('huntPresets', () => {
  it('toda predefinição usa enums fechados', () => {
    for (const p of HUNT_PRESETS) {
      const d = huntPreset(p);
      expect(HUNT_SORTS).toContain(d.source.sort);
      expect(HUNT_COMMISSION_BANDS).toContain(d.source.commissionBand);
    }
  });

  it('valores esperados', () => {
    expect(huntPreset('TOP_COMMISSION')).toEqual({
      source: { sort: 'RECOMMENDED', commissionBand: 'ABOVE_15' },
      local: { minCommissionPct: 15 },
    });
    expect(huntPreset('BEST_SELLERS').source.sort).toBe('BEST_SELLING');
    expect(huntPreset('BIGGEST_DISCOUNT').local.minDiscountPct).toBe(40);
    expect(huntPreset('NEW_ARRIVALS').source.sort).toBe('NEWEST');
    expect(huntPreset('CUSTOM')).toEqual({ source: { sort: 'RECOMMENDED', commissionBand: 'ANY' }, local: {} });
  });

  it('cópia nova: mutar o retorno não muda a predefinição', () => {
    const a = huntPreset('TOP_COMMISSION');
    a.local.minCommissionPct = 1;
    a.source.sort = 'NEWEST';
    expect(huntPreset('TOP_COMMISSION').local.minCommissionPct).toBe(15);
    expect(huntPreset('TOP_COMMISSION').source.sort).toBe('RECOMMENDED');
  });
});
