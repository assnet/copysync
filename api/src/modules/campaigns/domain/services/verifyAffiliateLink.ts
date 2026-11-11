import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';

/**
 * Resultado da checagem de dono do link colado:
 * - `verified`: identificador do link = credencial do tenant
 * - `unverified`: sem como confirmar (Shopee, ou tenant sem credencial do marketplace)
 * - `not_owned`: identificador de outra conta, ou identificadores divergentes no link
 * - `not_affiliate`: link sem identificador de afiliado
 */
export type AffiliateLinkCheck = 'verified' | 'unverified' | 'not_owned' | 'not_affiliate';

const SHEIN_URL_FROM = /^affiliate_koc_(\d+)$/;

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
 * cada `tag`; ML: cada `matt_word` e `/social/<etiqueta>`; Shein: o `<id>` de cada
 * `url_from=affiliate_koc_<id>`, outro formato não conta). Repetidos ficam: quem decide é o chamador.
 */
export function affiliateIdentifiersOf(provider: AffiliateProvider, url: URL): string[] {
  switch (provider) {
    case 'AMAZON':
      return params(url, 'tag');
    case 'MERCADO_LIVRE': {
      const social = socialTag(url);
      return [...params(url, 'matt_word'), ...(social ? [social] : [])];
    }
    case 'SHEIN':
      return params(url, 'url_from').flatMap((v) => SHEIN_URL_FROM.exec(v)?.[1] ?? []);
    default:
      return [];
  }
}

/** Primeiro identificador do link (ou null). */
export function affiliateIdentifierOf(provider: AffiliateProvider, url: URL): string | null {
  return affiliateIdentifiersOf(provider, url)[0] ?? null;
}

/**
 * Identificadores que provam o dono do link, juntando todas as URLs (colada e expandida). No ML o
 * `/social/<x>` é o apelido do perfil, não a etiqueta: com algum `matt_word` em qualquer URL só os
 * `matt_word` contam; o `/social/<x>` vale apenas quando não há nenhum. Demais marketplaces: todos
 * os identificadores de `affiliateIdentifiersOf`.
 */
export function ownershipIdentifiersOf(provider: AffiliateProvider, urls: readonly URL[]): string[] {
  if (provider !== 'MERCADO_LIVRE') return urls.flatMap((url) => affiliateIdentifiersOf(provider, url));
  const tags = urls.flatMap((url) => params(url, 'matt_word'));
  return tags.length > 0 ? tags : urls.flatMap((url) => socialTag(url) ?? []);
}

/**
 * Confere se o link é do tenant. Recebe a URL colada e a expandida juntas: os identificadores de
 * dono de todas valem (`ownershipIdentifiersOf`), e mais de um valor distinto (sem caixa) é
 * `not_owned` — evita `tag` duplicada ou redirect trocando a etiqueta. Link sem identificador é
 * recusado mesmo sem credencial: não renderia comissão a ninguém.
 */
export function verifyAffiliateLink(
  provider: AffiliateProvider,
  urls: URL | readonly URL[],
  credentialIdentifier: string | null,
): AffiliateLinkCheck {
  if (provider === 'SHOPEE') return 'unverified';
  const list = Array.isArray(urls) ? urls : [urls as URL];
  const found = new Set(ownershipIdentifiersOf(provider, list).map((v) => v.toLowerCase()));
  if (found.size === 0) return 'not_affiliate';
  if (found.size > 1) return 'not_owned';
  if (!credentialIdentifier?.trim()) return 'unverified';
  return found.has(credentialIdentifier.trim().toLowerCase()) ? 'verified' : 'not_owned';
}
