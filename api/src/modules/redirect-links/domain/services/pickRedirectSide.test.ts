import { describe, expect, it } from 'vitest';
import { pickRedirectSide } from './pickRedirectSide';

const fixed = (v: number) => () => v;

describe('pickRedirectSide', () => {
  it('sem B é sempre A, mesmo com percentual 0', () => {
    expect(pickRedirectSide({ urlB: null, percentA: 0 }, fixed(0.99))).toBe('A');
  });

  it('corte em percentA: rng*100 < percentA → A', () => {
    const link = { urlB: 'https://b.com', percentA: 30 };
    expect(pickRedirectSide(link, fixed(0.29))).toBe('A');
    expect(pickRedirectSide(link, fixed(0.3))).toBe('B');
  });

  it('0 = sempre B; 100 = sempre A', () => {
    expect(pickRedirectSide({ urlB: 'https://b.com', percentA: 0 }, fixed(0))).toBe('B');
    expect(pickRedirectSide({ urlB: 'https://b.com', percentA: 100 }, fixed(0.9999))).toBe('A');
  });

  it('distribuição com rng determinístico (sequência uniforme)', () => {
    let i = 0;
    const seq = () => (i++ % 100) / 100;
    const link = { urlB: 'https://b.com', percentA: 70 };
    const sides = Array.from({ length: 1000 }, () => pickRedirectSide(link, seq));
    expect(sides.filter((s) => s === 'A')).toHaveLength(700);
  });
});
