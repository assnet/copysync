import { AFFILIATE_PLANS_PATH } from '@/features/navigation';
/**
 * Gate de plano da Página de Ofertas: destino do upgrade. O reconhecimento do 403
 * (`isPlanFeatureUnavailable`) é compartilhado em `features/plans/planGate.ts`.
 */
export const storefrontUpgradePath = `${AFFILIATE_PLANS_PATH}?feature=storefront`;
