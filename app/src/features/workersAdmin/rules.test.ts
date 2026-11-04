import { describe, expect, it } from 'vitest';
import { occupancyLevel, occupancyPercent, sortWorkers } from './rules';

describe('occupancyPercent', () => {
  it('arredonda e limita a 0–100', () => {
    expect(occupancyPercent(1, 3)).toBe(33);
    expect(occupancyPercent(50, 40)).toBe(100);
    expect(occupancyPercent(0, 40)).toBe(0);
  });
  it('teto 0: cheio com sessão, vazio sem', () => {
    expect(occupancyPercent(2, 0)).toBe(100);
    expect(occupancyPercent(0, 0)).toBe(0);
  });
});

describe('occupancyLevel', () => {
  it('faixas ok / atenção / cheio', () => {
    expect(occupancyLevel(31, 40)).toBe('ok');
    expect(occupancyLevel(32, 40)).toBe('warning');
    expect(occupancyLevel(40, 40)).toBe('full');
  });
});

describe('sortWorkers', () => {
  it('mais ocupado primeiro, empate pelo id', () => {
    const list = [
      { workerId: 'b', sessions: 1, maxSessions: 10 },
      { workerId: 'c', sessions: 9, maxSessions: 10 },
      { workerId: 'a', sessions: 1, maxSessions: 10 },
    ];
    expect(sortWorkers(list).map((w) => w.workerId)).toEqual(['c', 'a', 'b']);
  });
});
