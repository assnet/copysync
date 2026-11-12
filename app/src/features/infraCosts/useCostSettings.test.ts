import { describe, expect, it } from 'vitest';
import { sampleSettings } from './testFixtures';
import { parseDraftPath, setDraftPath } from './useCostSettings';

describe('parseDraftPath', () => {
  it('lê o formato do meta.field', () => {
    expect(parseDraftPath('items[0].storage.gb')).toEqual(['items', 0, 'storage', 'gb']);
    expect(parseDraftPath('fx.override.rate')).toEqual(['fx', 'override', 'rate']);
    expect(() => parseDraftPath('items[x]')).toThrow();
  });
});

describe('setDraftPath', () => {
  it('troca só o caminho, sem mexer no original', () => {
    const base = sampleSettings();
    const next = setDraftPath(base, 'items[1].monthlyUsd', '30');
    expect(next.items[1].monthlyUsd).toBe('30');
    expect(base.items[1].monthlyUsd).toBe(25);
    expect(next.items[0]).toBe(base.items[0]);
    expect(next.workspace).toBe(base.workspace);
  });

  it('cria o objeto do caminho quando estava nulo', () => {
    const next = setDraftPath(sampleSettings(), 'items[1].storage', { gb: null, usdPerGb: null });
    expect(setDraftPath(next, 'items[1].storage.gb', '10').items[1].storage).toEqual({ gb: '10', usdPerGb: null });
  });
});
