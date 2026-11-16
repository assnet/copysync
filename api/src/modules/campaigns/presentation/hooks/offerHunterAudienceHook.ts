import type { FastifyRequest } from 'fastify';
import { resolveMembership } from '../../../../shared/http/hooks/resolveMembership';
import { OfferHunterUnavailableError } from '../../../../shared/errors/internal/OfferHuntErrors';
import { hunterContainer } from '../../infrastructure/hunterContainer';

/**
 * Portão de audiência das rotas do caçador. Roda depois de `authHook` + `tenantHook`. A flag do admin ("Só super
 * admin", `platform_settings.feature_audience`) é lida a cada requisição: trocar no admin vale no pedido seguinte.
 * Fora → 403 `OFFER_HUNTER_UNAVAILABLE`. Lança (nunca `send` + `return`), como pede o AGENTS.md §14.
 */
export async function offerHunterAudienceHook(request: FastifyRequest): Promise<void> {
  const allowed = await hunterContainer.audienceGate().allows({
    isSuperAdmin: request.user?.isSuperAdmin === true,
    tenantId: request.tenantContext?.tenantId ?? null,
  });
  if (!allowed) throw new OfferHunterUnavailableError();
}

/**
 * `GET /access` (só `authHook`): mesmo portão, sem 403 para ninguém. Com a flag desligada o tenant vem do
 * `X-Tenant-Id` e passa pela mesma validação do `tenantHook`; header ausente ou membro inválido = invisível.
 */
export async function isOfferHunterVisible(request: FastifyRequest): Promise<boolean> {
  const { userId, isSuperAdmin } = request.user;
  const gate = hunterContainer.audienceGate();
  const superAdminOnly = await gate.superAdminOnly();
  let tenantId: string | null = null;
  if (!superAdminOnly) {
    const header = request.headers['x-tenant-id'];
    if (typeof header !== 'string' || !header) return false;
    try {
      tenantId = (await resolveMembership(userId, header, isSuperAdmin === true)).tenantId;
    } catch {
      return false;
    }
  }
  return gate.allows({ isSuperAdmin: isSuperAdmin === true, tenantId }, superAdminOnly);
}
