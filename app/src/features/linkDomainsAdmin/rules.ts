/**
 * Regras puras do formulário, espelho fino de `api/.../admin/linkDomainRules.ts`. A API valida de
 * novo; aqui é só para o erro aparecer no campo antes de enviar.
 */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const RESERVED_NAME_MAX = 50;
/** Igual a `MAX_RESERVED_NAMES` da API. */
export const RESERVED_NAMES_MAX = 1000;

/** Minúsculo, sem esquema, caminho, porta nem ponto final. */
export function normalizeHostname(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/^.*@/, '')
    .replace(/:\d*$/, '')
    .replace(/\.+$/, '');
}

export function isValidHostname(raw: string): boolean {
  const h = normalizeHostname(raw);
  if (!h || h.length > 253) return false;
  const labels = h.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return false;
  return !/^\d+$/.test(labels[labels.length - 1]!);
}

/** Vazio é válido (sem landing). Senão só `https://` com host válido e sem credencial. */
export function isValidLandingUrl(raw: string): boolean {
  const v = raw.trim();
  if (v === '') return true;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  return isValidHostname(url.hostname) && normalizeHostname(url.hostname) === url.hostname;
}

/** Nome reservado normalizado ou `null` se inválido. */
export function normalizeReservedName(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v || v.length > RESERVED_NAME_MAX || !RESERVED_NAME.test(v)) return null;
  return v;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "há 5 minutos" a partir de horários do servidor (`now` = `serverNow()`). */
export function formatRelativeTime(iso: string, now: number, justNow: string): string {
  const diff = new Date(iso).getTime() - now;
  if (Number.isNaN(diff)) return '';
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return justNow;
}

export type MergeReservedResult =
  | { ok: true; names: string[] }
  | { ok: false; invalid: string }
  | { ok: false; tooMany: true };

/** Junta o texto digitado (vírgula, espaço ou `;` separam) aos nomes já escolhidos, sem duplicar. */
export function mergeReservedNames(current: readonly string[], raw: string): MergeReservedResult {
  const next = new Set(current);
  for (const part of raw.split(/[\s,;]+/).filter(Boolean)) {
    const name = normalizeReservedName(part);
    if (!name) return { ok: false, invalid: part };
    next.add(name);
  }
  if (next.size > RESERVED_NAMES_MAX) return { ok: false, tooMany: true };
  return { ok: true, names: [...next] };
}

/**
 * Validade da liberação a partir do `<input type="date">` (AAAA-MM-DD): fim do dia no fuso do
 * navegador, em ISO. Vazio = sem validade (`null`); data inválida ou que já passou = `'invalid'`.
 * `now` = `serverNow()`.
 */
export function grantExpiryToIso(date: string, now: number): string | null | 'invalid' {
  const v = date.trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'invalid';
  const end = new Date(`${v}T23:59:59.999`);
  if (Number.isNaN(end.getTime()) || end.getTime() <= now) return 'invalid';
  return end.toISOString();
}
