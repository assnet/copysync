import { useCallback } from 'react';
import { offerHunterService } from '@/services/offerHunter.service';
import type { HuntGateKey, HuntGates, SaveHunterSettingsInput } from '../types';
import { useHuntResource } from './useHuntResource';

/** Ordem em que a tela cobra os portões (a mesma da execução no servidor). `aiAvailable` não trava. */
export const HUNT_BLOCKING_GATES: readonly HuntGateKey[] = ['plan', 'hunterEntitlement', 'credential', 'riskAccepted', 'destination'];

/** Primeiro portão fechado que impede ligar/rodar uma caçada; null = liberado. */
export function firstClosedGate(gates: HuntGates | null | undefined): HuntGateKey | null {
  if (!gates) return null;
  return HUNT_BLOCKING_GATES.find((k) => !gates[k]) ?? null;
}

/** `GET /options`: categorias, ordenações, faixas, predefinições, limites e portões. */
export function useHuntOptions() {
  const r = useHuntResource('options', offerHunterService.getOptions);
  return { ...r, options: r.data, blockedBy: firstClosedGate(r.data?.gates) };
}

/** `GET /usage`: "X de N ofertas garimpadas hoje". Recarregar após rodar/aprovar. */
export function useHuntUsage() {
  const r = useHuntResource('usage', offerHunterService.getUsage);
  return { ...r, usage: r.data };
}

/** `GET|PUT /settings`: grupo de destino. `save` rejeita com o erro do `apiClient`. */
export function useHunterSettings() {
  const r = useHuntResource('settings', offerHunterService.getSettings);
  const { setData } = r;
  const save = useCallback(async (body: SaveHunterSettingsInput) => {
    const saved = await offerHunterService.saveSettings(body);
    setData(saved);
    return saved;
  }, [setData]);
  return { ...r, settings: r.data, save };
}
