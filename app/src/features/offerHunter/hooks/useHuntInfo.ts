import { useCallback, useEffect, useRef, useState } from 'react';
import { offerHunterService } from '@/services/offerHunter.service';
import type { HuntAiSuggestInput, HuntAiSuggestion, HuntGateKey, HuntGates, HuntOptions, HuntProvider, SaveHunterSettingsInput } from '../types';
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

/**
 * Opções por loja para nomear predefinição/categoria das caçadas de lojas diferentes da tela. A da tela (`known`)
 * é reaproveitada; as outras são buscadas uma vez por loja (só depois da da tela carregar) e ficam em memória
 * enquanto a tela vive. Falha = tenta de novo quando a lista de lojas (ou a loja da tela) mudar.
 */
export function useHuntOptionsByProvider(providers: readonly HuntProvider[], known: HuntOptions | null) {
  const [map, setMap] = useState<Partial<Record<HuntProvider, HuntOptions>>>({});
  const requested = useRef(new Set<HuntProvider>());
  const knownProvider = known ? (known.provider ?? 'SHEIN') : null;
  const wanted = [...new Set(providers)].sort().join(',');
  useEffect(() => {
    if (!knownProvider) return;
    for (const p of wanted.split(',').filter(Boolean) as HuntProvider[]) {
      if (p === knownProvider || requested.current.has(p)) continue;
      requested.current.add(p);
      offerHunterService.getOptions(p).then(
        (o) => setMap((m) => ({ ...m, [p]: o })),
        () => { requested.current.delete(p); },
      );
    }
  }, [wanted, knownProvider]);
  return useCallback(
    (provider: HuntProvider): HuntOptions | null => (provider === knownProvider ? known : map[provider] ?? null),
    [knownProvider, known, map],
  );
}

/** `GET /options/providers`: estado de cada loja (plano, conta, aceite) sem chamar a fonte. `enabled` false = não carrega. */
export function useHuntProviders(enabled = true) {
  const r = useHuntResource(enabled ? 'providers' : null, offerHunterService.getProviders);
  return { ...r, providers: r.data };
}

/** Status de tempo esgotado: 408, 504 e 524 (proxy cortou a resposta longa; vem sem código da API). */
const TIMEOUT_STATUSES: ReadonlySet<number> = new Set([408, 504, 524]);

/**
 * Código do erro da sugestão. Sem código da API (proxy, rede, tempo esgotado no cliente) vira um código de tela:
 * `REQUEST_TIMEOUT`, `SERVICE_UNAVAILABLE` ou `UNKNOWN` — cada um com mensagem própria em `strings.ts`.
 */
export function huntAiSuggestErrorCode(err: unknown): string {
  const code = huntErrorCode(err);
  if (code) return code;
  const e = (err ?? {}) as { status?: unknown; serviceUnavailable?: unknown };
  if (typeof e.status === 'number') {
    if (TIMEOUT_STATUSES.has(e.status)) return 'REQUEST_TIMEOUT';
    return e.serviceUnavailable === true ? 'SERVICE_UNAVAILABLE' : 'UNKNOWN';
  }
  // Sem resposta: `apiClient` marca rede/proxy como indisponível; o que sobra é timeout/cancelamento
  if (e.serviceUnavailable === true) return 'SERVICE_UNAVAILABLE';
  return e.serviceUnavailable === false ? 'REQUEST_TIMEOUT' : 'UNKNOWN';
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
      const code = huntAiSuggestErrorCode(err);
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
