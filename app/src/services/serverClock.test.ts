import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordServerTime, resetServerClock, serverClockOffset, serverNow, serverToLocal } from './serverClock';

afterEach(() => { resetServerClock(); vi.useRealTimers(); });

describe('serverClock', () => {
  it('sem amostra: offset 0', () => {
    expect(serverClockOffset()).toBe(0);
  });

  it('offset pelo ponto médio da ida e volta', () => {
    // saiu em 1000, voltou em 1200 → meio 1100; servidor marcou 6100 → +5000
    recordServerTime(6100, 1000, 1200);
    expect(serverClockOffset()).toBe(5000);
  });

  it('vale a amostra de menor latência', () => {
    recordServerTime(6100, 1000, 1200);   // rtt 200, +5000
    recordServerTime(7040, 2000, 2080);   // rtt 80,  +5000 ± ruído → +5000
    recordServerTime(9900, 3000, 3600);   // rtt 600, +6600 (ruidosa)
    expect(serverClockOffset()).toBe(5000);
  });

  it('ignora amostra inválida', () => {
    recordServerTime(Number.NaN, 1000, 1200);
    recordServerTime(5000, 2000, 1000);
    expect(serverClockOffset()).toBe(0);
  });

  it('serverNow e serverToLocal aplicam o offset', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    recordServerTime(5_100, 1000, 1200); // offset +4000
    expect(serverNow()).toBe(14_000);
    expect(serverToLocal(20_000).getTime()).toBe(16_000);
  });
});
