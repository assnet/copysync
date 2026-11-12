import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { readPersisted } from '@/hooks/usePersistedState';
import { adminCostsService } from '@/services/adminCosts.service';
import { draftToSettings } from './rules';
import { sampleSettings } from './testFixtures';
import type { InfraCostSettings, InfraCostSettingsDraft, InfraCostSettingsView } from './types';
import { COST_PRICES_DRAFT_KEY, parseDraftPath, setDraftPath, useCostSettings, type CostPricesDraftState } from './useCostSettings';

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

describe('useCostSettings: 409 com merge de 3 vias', () => {
  const view = (settings: InfraCostSettings, updatedAt: string): InfraCostSettingsView => ({ settings, origin: 'saved', updatedAt });
  const conflict = () => Object.assign(new Error('x'), { status: 409, code: 'INFRA_COST_SETTINGS_CONFLICT' });

  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  async function setup(theirs: InfraCostSettings) {
    vi.spyOn(adminCostsService, 'getSettings')
      .mockResolvedValueOnce(view(sampleSettings(), '2026-11-01T10:00:00.000Z'))
      .mockResolvedValueOnce(view(theirs, '2026-11-03T10:00:00.000Z'));
    vi.spyOn(adminCostsService, 'updateSettings').mockRejectedValueOnce(conflict());
    const hook = renderHook(() => useCostSettings());
    await waitFor(() => expect(hook.result.current.view).not.toBeNull());
    return hook;
  }

  it('não reverte o E-mail 23→30 do outro admin e mantém a minha alteração', async () => {
    const theirs = sampleSettings();
    theirs.items[2].monthlyUsd = 30;
    const { result } = await setup(theirs);
    act(() => result.current.change('workspace.planLabel', 'Pro'));
    const mine = draftToSettings(result.current.values as InfraCostSettingsDraft) as InfraCostSettings;
    let outcome: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => { outcome = await result.current.save(mine); });

    expect(outcome).toEqual({ status: 'conflict' });
    const merged = draftToSettings(result.current.values as InfraCostSettingsDraft) as InfraCostSettings;
    expect(merged.items[2].monthlyUsd).toBe(30);
    expect(merged.workspace.planLabel).toBe('Pro');
    expect(result.current.conflicts).toEqual([]);
    const draft = readPersisted<CostPricesDraftState>(COST_PRICES_DRAFT_KEY);
    expect(draft?.base).toBe('2026-11-03T10:00:00.000Z');
    expect(draft?.baseSettings?.items[2].monthlyUsd).toBe(30);
  });

  it('mesmo campo dos dois lados: fica o meu valor e o caminho vira conflito', async () => {
    const theirs = sampleSettings();
    theirs.items[2].monthlyUsd = 30;
    const { result } = await setup(theirs);
    act(() => result.current.change('items[2].monthlyUsd', '40'));
    const mine = draftToSettings(result.current.values as InfraCostSettingsDraft) as InfraCostSettings;
    await act(async () => { await result.current.save(mine); });
    expect(draftToSettings(result.current.values as InfraCostSettingsDraft)?.items[2].monthlyUsd).toBe(40);
    expect(result.current.conflicts).toEqual(['items[email].monthlyUsd']);
  });

  it('rascunho igual ao salvo novo depois do merge: descarta o rascunho', async () => {
    const theirs = sampleSettings();
    theirs.workspace.planLabel = 'Pro';
    const { result } = await setup(theirs);
    act(() => result.current.change('workspace.planLabel', 'Pro'));
    const mine = draftToSettings(result.current.values as InfraCostSettingsDraft) as InfraCostSettings;
    await act(async () => { await result.current.save(mine); });
    expect(result.current.dirty).toBe(false);
  });
});
