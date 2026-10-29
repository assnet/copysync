import { normalizeSlug, SLUG_MAX_LENGTH } from '../../../domain/services/slugRules';

/**
 * Regras puras do cadastro de domínio de links (super-admin). Devolvem `null` quando inválido;
 * os use cases traduzem para `LinkDomainInvalidError`.
 *
 * IDN (punycode/acentos) fica fora do escopo: só ASCII `[a-z0-9-]`.
 */

/**
 * Hosts da plataforma que nunca viram domínio de rodízio (nem eles nem subdomínios deles):
 * o wildcard capturaria o painel/API. Não há env com a URL pública da API, então a lista é
 * fixa aqui; `PANEL_URL` entra a mais via `platformHostnames()`.
 */
export const PLATFORM_HOSTNAMES: readonly string[] = ['app.copysync.app', 'api.copysync.app'];

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_HOSTNAME_LENGTH = 253;
/** Conferido só ao criar/renomear link; a lista vive numa coluna `text[]` do domínio. */
export const MAX_RESERVED_NAMES = 1000;
const RESERVED_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Minúsculo, sem esquema, credencial, porta, caminho, query nem ponto final. */
export function normalizeHostname(raw: string): string {
  let h = raw.trim().toLowerCase();
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  h = h.replace(/[/?#].*$/, '');
  h = h.replace(/^.*@/, '');
  h = h.replace(/:\d*$/, '');
  return h.replace(/\.+$/, '');
}

/** Hostname normalizado e válido (≥ 2 rótulos, TLD não numérico) ou `null`. */
export function parseHostname(raw: string): string | null {
  const h = normalizeHostname(raw);
  if (!h || h.length > MAX_HOSTNAME_LENGTH) return null;
  const labels = h.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  if (/^\d+$/.test(labels[labels.length - 1]!)) return null; // IPv4 literal
  return h;
}

/** Lista de hosts da plataforma, com o host de `PANEL_URL` quando configurado. */
export function platformHostnames(panelUrl?: string): string[] {
  const out = new Set(PLATFORM_HOSTNAMES);
  if (panelUrl) {
    try {
      out.add(new URL(panelUrl).hostname.toLowerCase());
    } catch {
      /* PANEL_URL já é validada em env.ts */
    }
  }
  return [...out];
}

/** true se `hostname` é um host da plataforma ou subdomínio de um. */
export function isPlatformHostname(hostname: string, platform: readonly string[]): boolean {
  return platform.some((p) => hostname === p || hostname.endsWith(`.${p}`));
}

/** `null` = sem landing; `undefined` = inválida. Só `https://` com host válido. */
export function parseLandingUrl(raw: string | null | undefined): string | null | undefined {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return undefined;
  if (parseHostname(url.hostname) !== url.hostname) return undefined;
  return url.toString();
}

/** Normaliza como slug, remove vazios e duplicados. `null` se algum nome ficar inválido. */
export function parseReservedNames(raw: readonly string[] | undefined): string[] | null {
  if (!raw) return [];
  if (raw.length > MAX_RESERVED_NAMES) return null;
  const out = new Set<string>();
  for (const name of raw) {
    const slug = normalizeSlug(name);
    if (!slug) continue;
    if (slug.length > SLUG_MAX_LENGTH || !RESERVED_NAME.test(slug)) return null;
    out.add(slug);
  }
  return [...out];
}
