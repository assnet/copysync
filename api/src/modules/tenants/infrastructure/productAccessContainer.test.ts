import { describe, expect, it } from 'vitest';
import { backgroundProductAccessEnforced, backgroundProductAccessReader } from './productAccessContainer';
import { AlwaysGrantedProductAccessReader } from './access/AlwaysGrantedProductAccessReader';
import { FailOpenProductAccessReader } from './access/FailOpenProductAccessReader';

describe('backgroundProductAccessReader', () => {
  it('off e log não consultam (sempre liberado); enforce lê com falha = liberado', () => {
    expect(backgroundProductAccessReader('off')).toBeInstanceOf(AlwaysGrantedProductAccessReader);
    expect(backgroundProductAccessReader('log')).toBeInstanceOf(AlwaysGrantedProductAccessReader);
    expect(backgroundProductAccessReader('enforce')).toBeInstanceOf(FailOpenProductAccessReader);
    expect([backgroundProductAccessEnforced('off'), backgroundProductAccessEnforced('log'), backgroundProductAccessEnforced('enforce')])
      .toEqual([false, false, true]);
  });
});
