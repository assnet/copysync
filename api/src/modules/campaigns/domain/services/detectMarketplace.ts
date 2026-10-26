import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';

/** Hosts aceitos por marketplace. Subdomínios entram por sufixo `.<host>`. */
const MARKETPLACE_HOSTS: Readonly<Record<AffiliateProvider, readonly string[]>> = {
  SHOPEE: ['shopee.com.br', 'shope.ee'],
  MERCADO_LIVRE: ['mercadolivre.com.br', 'mercadolivre.com', 'mercadolibre.com'],
  AMAZON: ['amazon.com.br', 'amzn.to'],
};

const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '');
}

/** Host exato ou subdomínio — `evilshopee.com.br` não casa com `shopee.com.br`. */
function matchesHost(hostname: string, allowed: string): boolean {
  return hostname === allowed || hostname.endsWith(`.${allowed}`);
}

/** Marketplace dono do host da URL, ou `null` se fora da allowlist. */
export function detectMarketplace(url: URL): AffiliateProvider | null {
  const hostname = normalizeHost(url.hostname);
  for (const [provider, hosts] of Object.entries(MARKETPLACE_HOSTS) as [AffiliateProvider, readonly string[]][]) {
    if (hosts.some((h) => matchesHost(hostname, h))) return provider;
  }
  return null;
}

/**
 * URL de produto que o sistema aceita buscar.
 *
 * Barreira de SSRF: só `https`, sem porta, sem userinfo e sem IP literal — o host
 * precisa ser um nome da allowlist. Vale para a URL colada e para cada salto de redirect.
 */
export function isSupportedProductUrl(url: URL): boolean {
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') {
    return false;
  }
  const hostname = normalizeHost(url.hostname);
  if (hostname.startsWith('[') || IPV4_LITERAL.test(hostname)) return false;
  return detectMarketplace(url) !== null;
}
