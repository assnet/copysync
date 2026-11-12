import type { FastifyRequest } from 'fastify';
import { env } from '../../../../shared/config/env';
import { resolveMembership } from '../../../../shared/http/hooks/resolveMembership';
import { OfferHunterUnavailableError } from '../../../../shared/errors/internal/OfferHuntErrors';
import { hunterContainer } from '../../infrastructure/hunterContainer';

/**
 * Portão de audiência das rotas do caçador. Roda depois de `authHook` + `tenantHook`. A env é lida a cada
 * requisição (trocar `OFFER_HUNTER_AUDIENCE` abre ao público sem deploy de código). Fora → 403
 * `OFFER_HUNTER_UNAVAILABLE`. Lança (nunca `send` + `return`), como pede o AGENTS.md §14.
 */
export async function offerHunterAudienceHook(request: FastifyRequest): Promise<void> {
  const allowed = await hunterContainer.audienceGate().allows({
    audience: env.OFFER_HUNTER_AUDIENCE,
    isSuperAdmin: request.user?.isSuperAdmin === true,
    tenantId: request.tenantContext?.tenantId ?? null,
  });
  if (!allowed) throw new OfferHunterUnavailableError();
}

/**
 * `GET /access` (só `authHook`): mesmo portão, sem 403 para ninguém. No modo `entitled` o tenant vem do
 * `X-Tenant-Id` e passa pela mesma validação do `tenantHook`; header ausente ou membro inválido = invisível.
 */
export async function isOfferHunterVisible(request: FastifyRequest): Promise<boolean> {
  const { userId, isSuperAdmin } = request.user;
  const audience = env.OFFER_HUNTER_AUDIENCE;
  let tenantId: string | null = null;
  if (audience === 'entitled') {
    const header = request.headers['x-tenant-id'];
    if (typeof header !== 'string' || !header) return false;
    try {
      tenantId = (await resolveMembership(userId, header, isSuperAdmin === true)).tenantId;
    } catch {
      return false;
    }
  }
  return hunterContainer.audienceGate().allows({ audience, isSuperAdmin: isSuperAdmin === true, tenantId });
}
