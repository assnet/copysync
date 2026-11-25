import type { FastifyRequest } from 'fastify';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { offersContainer } from '../../infrastructure/offersContainer';

const KEY = ENTITLEMENT_KEYS.OFFER_WATERMARK_ENABLED;

/**
 * Portão de audiência das rotas da marca d'água (spec IMG-12), depois de `authHook` + `tenantHook`. Flag "Só super
 * admin" lida a cada requisição. Fora → 404 `NOT_FOUND`, como recurso inexistente: a tela é invisível para quem
 * está fora, e o 403 fica só para o plano (`PLAN_FEATURE_UNAVAILABLE`, selo de plano no painel). Diferente do
 * caçador (403 próprio que junta audiência e plano). Lança (§14), nunca `send` + `return`.
 */
export async function offerWatermarkAudienceHook(request: FastifyRequest): Promise<void> {
  const visible = await offersContainer.offerWatermarkAudience().isVisible(KEY, { isSuperAdmin: request.tenantContext.isSuperAdmin });
  if (!visible) throw new NotFoundError('Resource');
}

/**
 * `GET /access` (só `authHook`): visível = audiência, nunca o plano (spec IMG-12, critério 8; mesmo critério do
 * Story). O PRO vê o item e a página, que mostra o selo de plano a partir do 403 `PLAN_FEATURE_UNAVAILABLE` do
 * `GET /`. Nunca 403: flag "Só super admin" ligada e usuário comum = `false`.
 */
export async function isOfferWatermarkVisible(request: FastifyRequest): Promise<boolean> {
  return offersContainer.offerWatermarkAudience().isVisible(KEY, { isSuperAdmin: request.user?.isSuperAdmin === true });
}
