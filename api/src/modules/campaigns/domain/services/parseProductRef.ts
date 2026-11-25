import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import { isAwinLink, kabumDestinationOf } from './detectMarketplace';

/** Identificador do produto extraído da URL, por marketplace. */
export type ProductRef =
  | { provider: 'SHOPEE'; shopId: string; itemId: string }
  | { provider: 'AMAZON'; asin: string }
  | { provider: 'MERCADO_LIVRE'; itemId: string; catalog: boolean }
  | { provider: 'SHEIN'; goodsId: string }
  | { provider: 'KABUM'; productId: string }
  /** `path`: caminho do produto sem o segmento da loja (`/<slug>/p/<sku>/<cat>/<sub>/`). */
  | { provider: 'MAGALU'; sku: string; path: string }
  | { provider: 'ALIEXPRESS'; productId: string };

const SHOPEE_PATHS = [/-i\.(\d+)\.(\d+)/, /\/product\/(\d+)\/(\d+)/, /\/opaanlp\/(\d+)\/(\d+)/];
const AMAZON_ASIN = /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN)\/([A-Z0-9]{10})(?![A-Z0-9])/i;
const ML_CATALOG = /\/p\/(MLB\d+)/i;
const ML_ITEM = /MLB-?(\d+)/i;
const SHEIN_GOODS = /-p-(\d{4,12})(?:-cat-\d+)?\.html$/i;
const SHEIN_GOODS_ID = /^\d{4,12}$/;
const KABUM_PRODUCT = /^\/produto\/(\d+)(?:\/|$)/;
const MAGALU_SKU = /\/p\/([a-z0-9]+)(?:\/|$)/i;
const ALIEXPRESS_ITEM = /\/item\/(\d+)\.html$/i;

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, '');
}

function isHostOrSub(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

/** Query sem diferenciar caixa do nome (`shopId`, `SHOPID`…). */
function queryParam(url: URL, name: string): string | null {
  for (const [key, value] of url.searchParams) {
    if (key.toLowerCase() === name) return value;
  }
  return null;
}

function parseShopee(url: URL): ProductRef | null {
  for (const re of SHOPEE_PATHS) {
    const m = re.exec(url.pathname);
    if (m) return { provider: 'SHOPEE', shopId: m[1], itemId: m[2] };
  }
  const shopId = queryParam(url, 'shopid');
  const itemId = queryParam(url, 'itemid');
  if (shopId && itemId && /^\d+$/.test(shopId) && /^\d+$/.test(itemId)) {
    return { provider: 'SHOPEE', shopId, itemId };
  }
  return null;
}

/** `m.shein.com` serve vários países: só `/br/` é da loja BR. */
function parseShein(url: URL): ProductRef | null {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'm.shein.com' && !/^\/br\//i.test(url.pathname)) return null;
  const m = SHEIN_GOODS.exec(url.pathname);
  if (m) return { provider: 'SHEIN', goodsId: m[1] };
  const goodsId = queryParam(url, 'goods_id');
  return goodsId && SHEIN_GOODS_ID.test(goodsId) ? { provider: 'SHEIN', goodsId } : null;
}

/** Link Awin: o produto vem do `ued` (lido sem rede), só anunciante 17729 com destino na Kabum. */
function parseKabum(url: URL): ProductRef | null {
  const target = isAwinLink(url) ? kabumDestinationOf(url) : url;
  if (!target || !isHostOrSub(hostOf(target), 'kabum.com.br')) return null;
  const m = KABUM_PRODUCT.exec(target.pathname);
  return m ? { provider: 'KABUM', productId: m[1] } : null;
}

/** Em `magazinevoce.com.br/<loja>/…` o 1º segmento é a loja do afiliado: sai do `path`. */
function parseMagalu(url: URL): ProductRef | null {
  const host = hostOf(url);
  let path: string;
  if (isHostOrSub(host, 'magazinevoce.com.br')) {
    const m = /^\/[^/]+(\/.*)$/.exec(url.pathname);
    if (!m) return null;
    path = m[1];
  } else if (isHostOrSub(host, 'magazineluiza.com.br')) {
    path = url.pathname;
  } else {
    return null;
  }
  const sku = MAGALU_SKU.exec(path);
  return sku ? { provider: 'MAGALU', sku: sku[1].toLowerCase(), path } : null;
}

/** Referência do produto na URL; `null` quando o formato não é reconhecido. */
export function parseProductRef(provider: AffiliateProvider, url: URL): ProductRef | null {
  switch (provider) {
    case 'SHOPEE':
      return parseShopee(url);
    case 'AMAZON': {
      const m = AMAZON_ASIN.exec(url.pathname);
      return m ? { provider: 'AMAZON', asin: m[1].toUpperCase() } : null;
    }
    case 'MERCADO_LIVRE': {
      const catalog = ML_CATALOG.exec(url.pathname);
      if (catalog) return { provider: 'MERCADO_LIVRE', itemId: catalog[1].toUpperCase(), catalog: true };
      const item = ML_ITEM.exec(url.pathname);
      return item ? { provider: 'MERCADO_LIVRE', itemId: `MLB${item[1]}`, catalog: false } : null;
    }
    case 'SHEIN':
      return parseShein(url);
    case 'KABUM':
      return parseKabum(url);
    case 'MAGALU':
      return parseMagalu(url);
    case 'ALIEXPRESS': {
      if (!isHostOrSub(hostOf(url), 'aliexpress.com')) return null;
      const m = ALIEXPRESS_ITEM.exec(url.pathname);
      return m ? { provider: 'ALIEXPRESS', productId: m[1] } : null;
    }
    default:
      return null;
  }
}
