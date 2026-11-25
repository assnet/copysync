import { KABUM_AWIN_ADVERTISER } from './detectMarketplace';

/**
 * URL canônica do produto Kabum: `https://www.kabum.com.br/produto/{id}`. A forma curta (sem slug) é a
 * que a loja serve (200) e independe do título; o catálogo (T7) não expõe `product_link`, e o slug colado
 * não é confiável (vem de terceiro). Só dígitos: o id já sai assim de `parseProductRef`.
 */
export function kabumProductUrl(productId: string): string {
  if (!/^\d{1,12}$/.test(productId)) throw new Error('Invalid Kabum product id');
  return `https://www.kabum.com.br/produto/${productId}`;
}

/**
 * Link de afiliado Kabum pela Awin (determinístico, sem rede):
 * `https://www.awin1.com/cread.php?awinmid=17729&awinaffid={publisherId}&ued={URL canônica codificada}`.
 */
export function kabumAffiliateUrl(publisherId: string, productId: string): string {
  return (
    `https://www.awin1.com/cread.php?awinmid=${KABUM_AWIN_ADVERTISER}` +
    `&awinaffid=${encodeURIComponent(publisherId)}` +
    `&ued=${encodeURIComponent(kabumProductUrl(productId))}`
  );
}
