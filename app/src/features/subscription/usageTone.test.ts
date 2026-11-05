import { describe, expect, it } from 'vitest';
import { usageTone } from './usageTone';

describe('usageTone', () => {
  it('ilimitado é default', () => expect(usageTone(999, null)).toBe('default'));
  it('100% ou acima é error', () => {
    expect(usageTone(10, 10)).toBe('error');
    expect(usageTone(12, 10)).toBe('error');
    expect(usageTone(0, 0)).toBe('error');
  });
  it('≥ 80% é warning', () => {
    expect(usageTone(8, 10)).toBe('warning');
    expect(usageTone(9, 10)).toBe('warning');
    expect(usageTone(1, 2)).toBe('warning');
  });
  it('abaixo de 80% é default', () => {
    expect(usageTone(7, 10)).toBe('default');
    expect(usageTone(0, 5)).toBe('default');
  });
});
