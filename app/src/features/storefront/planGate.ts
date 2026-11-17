import { PRODUCT_PLANS_PATH } from '@/features/products/productAccess';
/**
 * Gate de plano da Página de Ofertas: destino do upgrade. O reconhecimento do 403
 * (`isPlanFeatureUnavailable`) é compartilhado em `features/plans/planGate.ts`.
 */
export const storefrontUpgradePath = `${PRODUCT_PLANS_PATH.AFFILIATES}?feature=storefront`;
