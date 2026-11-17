import { describe, it, expect } from 'vitest';
import {
  fitsSaverLimit,
  readSaverFlag,
  readSaverLimit,
  readSaverLimits,
  remainingSaverLimit,
  SAVER_LIMIT_KEYS,
  effectiveSaverLimits,
  isSaverPilot,
} from './saverLimits';

describe('readSaverLimit', () => {
  it('chave ausente vale zero (nunca ilimitado)', () => {
    expect(readSaverLimit({}, SAVER_LIMIT_KEYS.GROUPS)).toBe(0);
  });

  it('null explícito vale ilimitado', () => {
    expect(readSaverLimit({ saver_contacts: null }, SAVER_LIMIT_KEYS.CONTACTS)).toBeNull();
  });

  it('número vale como teto', () => {
    expect(readSaverLimit({ saver_groups: 10 }, SAVER_LIMIT_KEYS.GROUPS)).toBe(10);
    expect(readSaverLimit({ saver_group_scans_per_day: 20.9 }, SAVER_LIMIT_KEYS.GROUP_SCANS_PER_DAY)).toBe(20);
  });

  it('valor inválido vale zero', () => {
    expect(readSaverLimit({ saver_groups: '10' }, SAVER_LIMIT_KEYS.GROUPS)).toBe(0);
    expect(readSaverLimit({ saver_groups: -1 }, SAVER_LIMIT_KEYS.GROUPS)).toBe(0);
    expect(readSaverLimit({ saver_groups: undefined }, SAVER_LIMIT_KEYS.GROUPS)).toBe(0);
  });
});

describe('readSaverFlag', () => {
  it('só true liga', () => {
    expect(readSaverFlag({}, SAVER_LIMIT_KEYS.AUTO_REFRESH_ENABLED)).toBe(false);
    expect(readSaverFlag({ saver_auto_refresh_enabled: null }, SAVER_LIMIT_KEYS.AUTO_REFRESH_ENABLED)).toBe(false);
    expect(readSaverFlag({ saver_auto_refresh_enabled: true }, SAVER_LIMIT_KEYS.AUTO_REFRESH_ENABLED)).toBe(true);
  });
});

describe('readSaverLimits', () => {
  it('lê o preset MAX (ilimitados explícitos) e o snapshot vazio', () => {
    expect(
      readSaverLimits({ saver_groups: null, saver_contacts: null, saver_group_scans_per_day: 500, saver_auto_refresh_enabled: true }),
    ).toEqual({ groups: null, contacts: null, groupScansPerDay: 500, autoRefreshEnabled: true });
    expect(readSaverLimits({})).toEqual({ groups: 0, contacts: 0, groupScansPerDay: 0, autoRefreshEnabled: false });
  });
});

describe('fitsSaverLimit / remainingSaverLimit', () => {
  it('confere o teto e as vagas', () => {
    expect(fitsSaverLimit(10, 8, 2)).toBe(true);
    expect(fitsSaverLimit(10, 8, 3)).toBe(false);
    expect(fitsSaverLimit(0, 0, 1)).toBe(false);
    expect(fitsSaverLimit(null, 1_000_000, 1)).toBe(true);
    expect(remainingSaverLimit(10, 12)).toBe(0);
    expect(remainingSaverLimit(null, 5)).toBeNull();
  });
});

describe('SAVER-47: piloto do super admin', () => {
  it('só super admin em tenant sem o produto é piloto', () => {
    expect(isSaverPilot(true, false)).toBe(true);
    expect(isSaverPilot(true, true)).toBe(false);
    expect(isSaverPilot(false, false)).toBe(false);
    expect(isSaverPilot(false, true)).toBe(false);
  });

  it('piloto usa o preset SAVER_MAX, ignorando o snapshot', () => {
    expect(effectiveSaverLimits({ saver_groups: 1 }, true)).toEqual({
      groups: null, groupScansPerDay: 500, contacts: null, autoRefreshEnabled: true,
    });
  });

  it('fora do piloto vale o snapshot (ausente = 0)', () => {
    expect(effectiveSaverLimits({}, false)).toEqual({ groups: 0, groupScansPerDay: 0, contacts: 0, autoRefreshEnabled: false });
  });
});
