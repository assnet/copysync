import type { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError } from '../../errors/internal/AuthErrors';
import { resolveMembership } from './resolveMembership';

/**
 * Fastify preHandler — resolves the active tenant from the X-Tenant-Id header.
 * Must run AFTER authHook (depends on request.user being populated).
 *
 * Validates that the authenticated user is actually a member of the given tenant.
 * Super-admins bypass membership check but the tenant must still exist and be ACTIVE.
 *
 * On success: populates request.tenantContext.
 */
export async function tenantHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const tenantId = request.headers['x-tenant-id'];

  if (!tenantId || typeof tenantId !== 'string') {
    throw new UnauthorizedError('Missing or invalid X-Tenant-Id header');
  }

  const { userId, isSuperAdmin } = request.user;

  request.tenantContext = await resolveMembership(userId, tenantId, isSuperAdmin);
}
