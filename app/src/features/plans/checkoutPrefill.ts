/**
 * Autopreenchimento do link de pagamento hospedado com os dados do usuário logado.
 *
 * A API decide o que pode sair (`GET /me/checkout-prefill`: só e-mail e nome válidos para o
 * formulário do gateway); aqui só se decide se o destino recebe e como anexar. Regras (mesmas da
 * API central): só `https://pay.cakto.com.br`; link que já traz e-mail foi feito para outra pessoa
 * e não recebe nada; chave já preenchida não é sobrescrita. Dado pessoal: só em memória, nunca em
 * `usePersistedState`/localStorage. Doc: docs/planos.md, "Links de pagamento". Função pura.
 */
import { appendQuery } from './queryAppend';

export const CHECKOUT_PREFILL_HOSTS: readonly string[] = ['pay.cakto.com.br'];
export const CHECKOUT_PREFILL_KEYS = ['name', 'email', 'confirmEmail'] as const;
export const CHECKOUT_PREFILL_TIMEOUT_MS = 2500;

export type CheckoutPrefill = Partial<Record<(typeof CHECKOUT_PREFILL_KEYS)[number], string>>;

const filled = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

export function isCheckoutPrefillTarget(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && CHECKOUT_PREFILL_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function appendCheckoutPrefill(url: string, prefill: CheckoutPrefill | null | undefined): string {
  if (!prefill || typeof prefill !== 'object' || !isCheckoutPrefillTarget(url)) return url;
  try {
    // Chave preenchida se QUALQUER ocorrência tem valor; comparação sem diferenciar maiúsculas.
    const filledKeys = new Set<string>();
    for (const [key, value] of new URL(url).searchParams) if (filled(value)) filledKeys.add(key.toLowerCase());
    if (filledKeys.has('email')) return url;
    const additions = new URLSearchParams();
    for (const key of CHECKOUT_PREFILL_KEYS) {
      const value = Object.prototype.hasOwnProperty.call(prefill, key) ? prefill[key] : undefined;
      if (filled(value) && !filledKeys.has(key.toLowerCase())) additions.set(key, value);
    }
    // Segmento vazio da chave a preencher sai (chave preenchida nunca chega aqui).
    return appendQuery(url, additions, new Set([...additions.keys()].map((k) => k.toLowerCase())));
  } catch {
    return url;
  }
}
