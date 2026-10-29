/**
 * URL de produto do ML pronta para leitura: catálogo `[/slug]/p/MLB…` vira
 * `https://www.mercadolivre.com.br/p/MLB…` e item `MLB-…` perde só query e fragment. Query de
 * carrinho/filtro (`pdp_filters`, `sid=cart`…) leva mais vezes à página de verificação; a URL limpa
 * é a que o gerador lê bem. Fora desses formatos: null (lê a URL como veio). Só para a leitura:
 * `sourceUrl` e o link de afiliado seguem como colados.
 */
export function canonicalMercadoLivreProductUrl(url: URL): URL | null {
  if (!isMercadoLivreHost(url.hostname)) return null;
  const catalog = /^\/(?:[^/]+\/)?p\/(MLB\d+)\/?$/i.exec(url.pathname);
  if (catalog) return new URL(`https://www.mercadolivre.com.br/p/${catalog[1].toUpperCase()}`);
  if (/^\/MLB-\d+(?:-[^/]*)?\/?$/i.test(url.pathname)) return new URL(`https://${url.hostname.toLowerCase()}${url.pathname}`);
  return null;
}

/**
 * Página de verificação/anti-bot do ML (`/gz/account-verification`, `/gz/webdevice/…`, captcha):
 * não é produto. Título dela ("Segurança", "Mercado Libre") nunca vira título de oferta.
 */
export function isMercadoLivreChallengeUrl(url: URL): boolean {
  if (!isMercadoLivreHost(url.hostname)) return false;
  const path = url.pathname.toLowerCase();
  return path.startsWith('/gz/') || path.includes('account-verification') || path.includes('captcha');
}

function isMercadoLivreHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'mercadolivre.com.br' || host.endsWith('.mercadolivre.com.br');
}
