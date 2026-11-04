import { describe, expect, it } from 'vitest';
import { SessionLeaseLedger } from './SessionLeaseLedger';

describe('SessionLeaseLedger', () => {
  it('marca, atualiza e lista ids', () => {
    const l = new SessionLeaseLedger();
    l.markOk('s1', new Date(1000));
    l.markOk('s2', new Date(2000));
    l.markOk('s1', new Date(3000));
    expect(l.ids().sort()).toEqual(['s1', 's2']);
    expect(l.lastOk('s1')).toEqual(new Date(3000));
  });

  it('drop remove e é idempotente', () => {
    const l = new SessionLeaseLedger();
    l.markOk('s1', new Date(1000));
    l.drop('s1');
    l.drop('s1');
    expect(l.ids()).toEqual([]);
    expect(l.lastOk('s1')).toBeUndefined();
  });

  it('fence guarda tentativas; markOk e clearFenced zeram', () => {
    const l = new SessionLeaseLedger();
    l.markOk('s1', new Date(1000));
    l.markFenced('s1');
    expect(l.ids()).toEqual([]);
    expect(l.fenceAttempts('s1')).toBe(0);
    l.markFenced('s1', 3);
    expect(l.fencedIds()).toEqual(['s1']);
    expect(l.fenceAttempts('s1')).toBe(3);
    l.markOk('s1', new Date(2000));
    expect(l.fencedIds()).toEqual([]);
    expect(l.fenceAttempts('s1')).toBe(0);
    l.markFenced('s2', 1);
    l.clearFenced('s2');
    expect(l.fencedIds()).toEqual([]);
  });
});
