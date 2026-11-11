/** Hosts de link curto oficial dos marketplaces (encurtadores que redirecionam para o produto). */
export const SHORT_HOSTS: ReadonlySet<string> = new Set([
  's.shopee.com.br',
  'shope.ee',
  'shp.ee',
  'br.shp.ee',
  'shoope.top',
  'amzn.to',
  'a.co',
  'link.amazon',
  'amzlinks.in',
  'meli.la',
  'click1.mercadolivre.com.br',
  'onelink.shein.com',
]);

/**
 * Link curto conhecido (precisa expandir para chegar ao produto). `mercadolivre.com` (sem `www.` e
 * sem `.br`) com `/sec/` ou `/social/` também é curto; `www.mercadolivre.com.br/social/…` não.
 */
export function isShortLink(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (SHORT_HOSTS.has(host)) return true;
  return host === 'mercadolivre.com' && (url.pathname.startsWith('/sec/') || url.pathname.startsWith('/social/'));
}
