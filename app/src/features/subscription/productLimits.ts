/**
 * Assinatura por produto (docs/acesso-por-produto.md). Funções puras: um cartão por produto com acesso e
 * a tabela de limites filtrada pelo produto dono de cada chave (vem da API em `limits[].product`).
 */
import { isProductKey, type ProductKey } from '@/features/products';
import { navigationStrings } from '@/features/navigation';
import type { SubscriptionLimitItem, SubscriptionProductItem, SubscriptionResponse } from '@/types/api.types';
import { SAVER_MIN_TIER } from './strings';

/** Recurso da conta, comum a todos os produtos (mesmo `SHARED_KEYS` da API). */
const SHARED_LIMIT_KEYS: readonly string[] = ['whatsapp_sessions', 'telegram_sessions'];

/** Produto da chave; `null` = recurso da conta. API antiga (sem `product`) decide pela chave. */
export function productOfLimit(item: SubscriptionLimitItem): ProductKey | null {
  if (item.product !== undefined) return isProductKey(item.product) ? item.product : null;
  if (SHARED_LIMIT_KEYS.includes(item.key)) return null;
  return item.key in SAVER_MIN_TIER ? 'SAVER' : 'AFFILIATES';
}

export interface SubscriptionProductCard {
  product: ProductKey;
  item: SubscriptionProductItem;
}

/**
 * Cartões na ordem da API. Sem `products` (API antiga) ou lista vazia = só Afiliados com os campos do topo:
 * o tenant legado vê a mesma tela de antes. `CHAT` não tem cartão (acompanha Afiliados).
 */
export function subscriptionProductCards(sub: SubscriptionResponse): SubscriptionProductCard[] {
  const cards = (sub.products ?? [])
    .filter((p): p is SubscriptionProductItem & { product: ProductKey } => isProductKey(p.product) && p.product !== 'CHAT')
    .map((item) => ({ product: item.product, item }));
  if (cards.length > 0) return cards;
  return [{ product: 'AFFILIATES', item: { product: 'AFFILIATES', planSlug: null, tier: sub.planSlug, expiresAt: sub.expiresAt, source: null } }];
}

/** Limites do produto; `withShared` acrescenta os da conta (só no primeiro cartão, sem repetir). */
export function limitsForProduct(limits: readonly SubscriptionLimitItem[], product: ProductKey, withShared: boolean): SubscriptionLimitItem[] {
  return limits.filter((l) => {
    const owner = productOfLimit(l);
    return owner === product || (withShared && owner === null);
  });
}

const PRODUCT_LABEL: Record<ProductKey, string> = {
  AFFILIATES: navigationStrings.products.affiliates.label,
  CHAT: navigationStrings.products.affiliates.label,
  SAVER: navigationStrings.products.saver.label,
};

export function productLabel(product: ProductKey): string {
  return PRODUCT_LABEL[product];
}
