import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';

/** Hosts aceitos por marketplace. Subdomínios entram por sufixo `.<host>`. */
const MARKETPLACE_HOSTS: Readonly<Record<AffiliateProvider, readonly string[]>> = {
  // `shp.ee` cobre `br.shp.ee` (encurtador atual do app/painel de afiliados Shopee BR)
  // `shoope.top`: encurtador de TERCEIRO (DivulgaLinks), não é da Shopee; só passa se o redirect
  // cair em `shopee.com.br` (cada salto é revalidado em `HttpShortLinkExpander`)
  SHOPEE: ['shopee.com.br', 'shope.ee', 'shp.ee', 'shoope.top'],
  MERCADO_LIVRE: ['mercadolivre.com.br', 'mercadolivre.com', 'mercadolibre.com', 'meli.la'],
  // `a.co` = botão Compartilhar do app/site Amazon; `link.amazon` (gTLD da Amazon) salta por
  // `amzlinks.in` até `amazon.com.br`. Encurtadores só valem se o redirect cair em `amazon.com.br`
  AMAZON: ['amazon.com.br', 'amzn.to', 'a.co', 'link.amazon', 'amzlinks.in'],
  // Nunca `shein.com` inteiro: `us.shein.com` e afins são outras lojas (outro programa de afiliados)
  SHEIN: ['br.shein.com', 'm.shein.com', 'onelink.shein.com'],
  // Link Awin (`awin1.com`) não entra aqui: é da rede toda, decidido em `kabumDestinationOf`.
  // `tidd.ly` fica fora: o anunciante só aparece depois de expandir
  KABUM: ['kabum.com.br'],
  // `magazineluiza.com.br` nunca recebe requisição: só o caminho é lido (MGL-02)
  MAGALU: ['magazineluiza.com.br', 'magazinevoce.com.br'],
  // Só `.com` (com subdomínios `pt.`, `s.click.`, `a.`); `aliexpress.us`/`.ru` são outras lojas
  ALIEXPRESS: ['aliexpress.com'],
};

/** Rede Awin: o host sozinho não diz a loja; vale só o anunciante da Kabum. */
const AWIN_HOST = 'awin1.com';
const KABUM_AWIN_ADVERTISER = '17729';

const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '');
}

/** Host exato ou subdomínio — `evilshopee.com.br` não casa com `shopee.com.br`. */
function matchesHost(hostname: string, allowed: string): boolean {
  return hostname === allowed || hostname.endsWith(`.${allowed}`);
}

/** Valores do parâmetro da query (nome sem diferenciar caixa). */
function queryValues(url: URL, name: string): string[] {
  const out: string[] = [];
  for (const [key, value] of url.searchParams) {
    if (key.toLowerCase() === name) out.push(value.trim());
  }
  return out;
}

/** Link da rede Awin (`*.awin1.com`), de qualquer anunciante. */
export function isAwinLink(url: URL): boolean {
  return matchesHost(normalizeHost(url.hostname), AWIN_HOST);
}

/**
 * Destino Kabum de um link Awin `awin1.com/cread.php`, lido só da query (sem rede): exige um único
 * `awinmid` = 17729 e um único `ued` que, já decodificado, seja `https` em `kabum.com.br`. Qualquer
 * outro caso (outro anunciante, destino fora da Kabum, `ued` ausente/duplicado/inválido) = `null`.
 */
export function kabumDestinationOf(url: URL): URL | null {
  if (!isAwinLink(url) || url.pathname.toLowerCase() !== '/cread.php') return null;
  const mids = queryValues(url, 'awinmid');
  if (mids.length !== 1 || mids[0] !== KABUM_AWIN_ADVERTISER) return null;
  const ued = queryValues(url, 'ued');
  if (ued.length !== 1) return null;
  let dest: URL;
  try {
    dest = new URL(ued[0]);
  } catch {
    return null;
  }
  if (dest.protocol !== 'https:' || dest.port !== '' || dest.username !== '' || dest.password !== '') return null;
  return matchesHost(normalizeHost(dest.hostname), 'kabum.com.br') ? dest : null;
}

/**
 * Marketplace dono da URL, ou `null` se fora da allowlist. Decide pelo host, exceto `awin1.com`,
 * que só é KABUM com anunciante 17729 e destino na Kabum (`kabumDestinationOf`).
 */
export function detectMarketplace(url: URL): AffiliateProvider | null {
  const hostname = normalizeHost(url.hostname);
  if (matchesHost(hostname, AWIN_HOST)) return kabumDestinationOf(url) ? 'KABUM' : null;
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
