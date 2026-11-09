import { describe, expect, it } from 'vitest';
import { OpsMetricsRingBuffer } from './OpsMetricsRingBuffer';

describe('OpsMetricsRingBuffer', () => {
  it('guarda no máximo a capacidade, descartando os mais antigos', () => {
    const b = new OpsMetricsRingBuffer(3);
    for (let i = 0; i < 5; i++) b.push({ at: new Date(i * 1000), readings: [] });
    expect(b.size).toBe(3);
    expect(b.since(new Date(0)).map((t) => t.at.getTime())).toEqual([2000, 3000, 4000]);
    expect(b.since(new Date(3500)).map((t) => t.at.getTime())).toEqual([4000]);
    b.clear();
    expect(b.size).toBe(0);
  });
});
