import { PRODUCT_PLANS_PATH } from '@/features/products/productAccess';
/** Destino do upgrade do Story de Oferta (exclusivo Business). Reconhecimento do 403 em `features/plans/planGate.ts`. */
export const offerStoryUpgradePath = `${PRODUCT_PLANS_PATH.AFFILIATES}?feature=offerStory`;
