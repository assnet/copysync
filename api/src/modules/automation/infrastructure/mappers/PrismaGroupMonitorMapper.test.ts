import { describe, expect, it } from 'vitest';
import { DEFAULT_MONITOR_SETTINGS } from '../../domain/services/monitorSettings';
import { PrismaGroupMonitorMapper as M } from './PrismaGroupMonitorMapper';

const row = (weekdaysMask: number) => ({ id: 'c1', tenantId: 't1', sessionId: 's1', ...DEFAULT_MONITOR_SETTINGS, weekdaysMask });

describe('PrismaGroupMonitorMapper', () => {
  it('mask 127 vira todos os dias', () => {
    expect(M.toConfig(row(127)).weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('mask seg–sex vira lista ordenada e não vaza a coluna', () => {
    const c = M.toConfig(row(0b0111110));
    expect(c.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(c).not.toHaveProperty('weekdaysMask');
    expect(c).toMatchObject({ id: 'c1', tenantId: 't1', sessionId: 's1', windowStartMinute: 360 });
  });

  it('lista vira mask na gravação, em qualquer ordem', () => {
    expect(M.toSettingsData({ ...DEFAULT_MONITOR_SETTINGS, weekdays: [5, 0, 6] }).weekdaysMask).toBe(0b1100001);
  });

  it('sem weekdays não grava a coluna (mantém o salvo) e não repassa campo estranho', () => {
    const data = M.toSettingsData({ ...DEFAULT_MONITOR_SETTINGS, extra: 1 } as never);
    expect(data).not.toHaveProperty('weekdaysMask');
    expect(data).not.toHaveProperty('weekdays');
    expect(data).not.toHaveProperty('extra');
    expect(data).toEqual(DEFAULT_MONITOR_SETTINGS);
  });

  it('ida e volta preserva os dias', () => {
    const days = [0, 3, 6];
    const mask = M.toSettingsData({ ...DEFAULT_MONITOR_SETTINGS, weekdays: days }).weekdaysMask!;
    expect(M.toConfig(row(mask)).weekdays).toEqual(days);
  });
});
