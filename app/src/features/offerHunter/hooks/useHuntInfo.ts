import { useCallback, useState } from 'react';
import { offerHunterService } from '@/services/offerHunter.service';
import type { HuntAiSuggestInput, HuntAiSuggestion, HuntGateKey, HuntGates, HuntProvider, SaveHunterSettingsInput } from '../types';
import { huntErrorCode, useHuntResource } from './useHuntResource';

/** Ordem em que a tela cobra os portões (a mesma da execução no servidor). `aiAvailable` não trava. */
export const HUNT_BLOCKING_GATES: readonly HuntGateKey[] = ['plan', 'hunterEntitlement', 'credential', 'riskAccepted', 'destination'];

/** Primeiro portão fechado que impede ligar/rodar uma caçada; null = liberado. */
export function firstClosedGate(gates: HuntGates | null | undefined): HuntGateKey | null {
  if (!gates) return null;
  return HUNT_BLOCKING_GATES.find((k) => !gates[k]) ?? null;
}

/**
 * `GET /options?provider=`: capacidades, categorias, ordenações, predefinições, limites e portões da loja.
 * `provider` null = não carrega (loja ainda não escolhida).
 */
export function useHuntOptions(provider: HuntProvider | null = 'SHEIN') {
  const load = useCallback(() => offerHunterService.getOptions(provider ?? 'SHEIN'), [provider]);
  const r = useHuntResource(provider ? `options:${provider}` : null, load);
  return { ...r, options: r.data, blockedBy: firstClosedGate(r.data?.gates) };
}

/** `GET /options/providers`: estado de cada loja (plano, conta, aceite) sem chamar a fonte. `enabled` false = não carrega. */
export function useHuntProviders(enabled = true) {
  const r = useHuntResource(enabled ? 'providers' : null, offerHunterService.getProviders);
  return { ...r, providers: r.data };
}

/** `POST /ai-suggest`: rascunho da IA. `suggest` nunca rejeita: devolve `{ data }` ou `{ errorCode }`. */
export function useHuntAiSuggest() {
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const suggest = useCallback(async (body: HuntAiSuggestInput): Promise<{ data: HuntAiSuggestion | null; errorCode: string | null }> => {
    setLoading(true);
    setErrorCode(null);
    try {
      return { data: await offerHunterService.suggestConfig(body), errorCode: null };
    } catch (err) {
      const code = huntErrorCode(err) ?? 'UNKNOWN';
      setErrorCode(code);
      return { data: null, errorCode: code };
    } finally {
      setLoading(false);
    }
  }, []);
  return { suggest, loading, errorCode, clearError: useCallback(() => setErrorCode(null), []) };
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
