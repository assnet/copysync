import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';

/** Identificador do produto extraído da URL, por marketplace. */
export type ProductRef =
  | { provider: 'SHOPEE'; shopId: string; itemId: string }
  | { provider: 'AMAZON'; asin: string }
  | { provider: 'MERCADO_LIVRE'; itemId: string; catalog: boolean };

const SHOPEE_PATHS = [/-i\.(\d+)\.(\d+)/, /\/product\/(\d+)\/(\d+)/, /\/opaanlp\/(\d+)\/(\d+)/];
const AMAZON_ASIN = /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN)\/([A-Z0-9]{10})(?![A-Z0-9])/i;
const ML_CATALOG = /\/p\/(MLB\d+)/i;
const ML_ITEM = /MLB-?(\d+)/i;

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
    default:
      return null;
  }
}
