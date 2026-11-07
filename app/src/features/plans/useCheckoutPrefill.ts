import { useCallback, useEffect, useRef } from 'react';
import { accountService } from '@/services/account.service';
import { CHECKOUT_PREFILL_KEYS, CHECKOUT_PREFILL_TIMEOUT_MS, type CheckoutPrefill } from './checkoutPrefill';

/**
 * Busca o autopreenchimento do link de pagamento ao montar a vitrine (não no clique: o clique
 * precisa abrir a aba de forma síncrona). Guarda só em memória (ref): é dado pessoal, nunca vai
 * para `usePersistedState`/localStorage. Falha ou timeout → `{}` (link sem dados).
 * Devolve um leitor estável do valor atual.
 */
export function useCheckoutPrefill(timeoutMs = CHECKOUT_PREFILL_TIMEOUT_MS): () => CheckoutPrefill {
  const prefill = useRef<CheckoutPrefill>({});
  useEffect(() => {
    const controller = new AbortController();
    accountService
      .getCheckoutPrefill({ timeout: timeoutMs, signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted || !data || typeof data !== 'object') return;
        const clean: CheckoutPrefill = {};
        for (const key of CHECKOUT_PREFILL_KEYS) if (typeof data[key] === 'string') clean[key] = data[key];
        prefill.current = clean;
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      prefill.current = {};
    };
  }, [timeoutMs]);
  return useCallback(() => prefill.current, []);
}
