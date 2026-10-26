import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';

/**
 * Resultado da checagem de dono do link colado:
 * - `verified`: identificador do link = credencial do tenant
 * - `unverified`: sem como confirmar (Shopee, ou tenant sem credencial do marketplace)
 * - `not_owned`: identificador de outra conta, ou identificadores divergentes no link
 * - `not_affiliate`: link sem identificador de afiliado
 */
export type AffiliateLinkCheck = 'verified' | 'unverified' | 'not_owned' | 'not_affiliate';

/** Todos os valores não vazios do parâmetro (nome sem diferenciar caixa). */
function params(url: URL, name: string): string[] {
  const out: string[] = [];
  for (const [key, value] of url.searchParams) {
    if (key.toLowerCase() === name && value.trim()) out.push(value.trim());
  }
  return out;
}

function socialTag(url: URL): string | null {
  const social = /^\/social\/([^/?#]+)/i.exec(url.pathname)?.[1];
  if (!social) return null;
  try {
    return decodeURIComponent(social);
  } catch {
    return social;
  }
}

/**
 * Todos os identificadores de afiliado presentes no link, na ordem em que aparecem (Amazon:
 * cada `tag`; ML: cada `matt_word` e `/social/<etiqueta>`). Repetidos ficam: quem decide é o chamador.
 */
export function affiliateIdentifiersOf(provider: AffiliateProvider, url: URL): string[] {
  switch (provider) {
    case 'AMAZON':
      return params(url, 'tag');
    case 'MERCADO_LIVRE': {
      const social = socialTag(url);
      return [...params(url, 'matt_word'), ...(social ? [social] : [])];
    }
    default:
      return [];
  }
}

/** Primeiro identificador do link (ou null). */
export function affiliateIdentifierOf(provider: AffiliateProvider, url: URL): string | null {
  return affiliateIdentifiersOf(provider, url)[0] ?? null;
}

/**
 * Confere se o link é do tenant. Recebe a URL colada e a expandida juntas: os identificadores de
 * todas valem, e mais de um valor distinto (sem caixa) é `not_owned` — evita `tag` duplicada ou
 * redirect trocando a etiqueta. Link sem identificador é recusado mesmo sem credencial: não
 * renderia comissão a ninguém.
 */
export function verifyAffiliateLink(
  provider: AffiliateProvider,
  urls: URL | readonly URL[],
  credentialIdentifier: string | null,
): AffiliateLinkCheck {
  if (provider === 'SHOPEE') return 'unverified';
  const list = Array.isArray(urls) ? urls : [urls as URL];
  const found = new Set(list.flatMap((url) => affiliateIdentifiersOf(provider, url).map((v) => v.toLowerCase())));
  if (found.size === 0) return 'not_affiliate';
  if (found.size > 1) return 'not_owned';
  if (!credentialIdentifier?.trim()) return 'unverified';
  return found.has(credentialIdentifier.trim().toLowerCase()) ? 'verified' : 'not_owned';
}
