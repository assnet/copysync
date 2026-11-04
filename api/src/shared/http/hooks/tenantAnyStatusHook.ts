import type { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError } from '../../errors/internal/AuthErrors';
import { resolveMembership } from './resolveMembership';

/**
 * Variante do `tenantHook` que aceita tenant SUSPENDED/CANCELLED (mesmo header
 * `X-Tenant-Id`, mesma validação de membership: não-membro segue 403).
 *
 * Existe só para a rota de assinatura (`GET /subscription`): o cliente suspenso
 * precisa ver o motivo e o link de pagamento. NÃO reusar em outra rota, isso abre
 * dado de tenant suspenso. Roda depois do `authHook`.
 */
export async function tenantAnyStatusHook(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const tenantId = request.headers['x-tenant-id'];

  if (!tenantId || typeof tenantId !== 'string') {
    throw new UnauthorizedError('Missing or invalid X-Tenant-Id header');
  }

  const { userId, isSuperAdmin } = request.user;

  request.tenantContext = await resolveMembership(userId, tenantId, isSuperAdmin, {
    allowInactive: true,
  });
}
