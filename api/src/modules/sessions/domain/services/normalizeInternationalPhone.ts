import { normalizeBrazilPhone } from './normalizeBrazilPhone';

/**
 * Telefone de conta Telegram: só dígitos com DDI (E.164 sem `+`), 8–15 dígitos.
 * Entrada só com DDD + número (10–11 dígitos) é tratada como brasileira e recebe `55`.
 * Qualquer outro formato → `null`.
 */
export function normalizeInternationalPhone(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  // Sem `+` e com tamanho de número nacional: assume Brasil (mesma regra do WhatsApp)
  if (!trimmed.startsWith('+') && (digits.length === 10 || digits.length === 11)) {
    return normalizeBrazilPhone(digits);
  }
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  return digits;
}
