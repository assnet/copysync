import type { FastifyRequest } from 'fastify';
import { resolveMembership } from '../../../../shared/http/hooks/resolveMembership';
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
 * `GET /access` (só `authHook`): visível = audiência E plano. Nunca 403: audiência fora, `X-Tenant-Id` ausente,
 * membro inválido ou plano sem a chave = `false`. Tenant validado como no `tenantHook` (padrão do caçador).
 */
export async function isOfferWatermarkVisible(request: FastifyRequest): Promise<boolean> {
  const isSuperAdmin = request.user?.isSuperAdmin === true;
  if (!(await offersContainer.offerWatermarkAudience().isVisible(KEY, { isSuperAdmin }))) return false;
  const header = request.headers['x-tenant-id'];
  if (typeof header !== 'string' || !header) return false;
  let tenantId: string;
  try {
    tenantId = (await resolveMembership(request.user.userId, header, isSuperAdmin)).tenantId;
  } catch {
    return false;
  }
  return (await offersContainer.entitlements().getBoolean(tenantId, KEY)) === true;
}
