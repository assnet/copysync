import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../database/prisma.client';
import { UnauthorizedError, ForbiddenError } from '../../errors/internal/AuthErrors';

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

  if (isSuperAdmin) {
    // Super-admins can operate on any active tenant
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true },
    });

    if (!tenant) {
      throw new ForbiddenError(`Tenant not found: ${tenantId}`);
    }
    if (tenant.status !== 'ACTIVE') {
      throw new ForbiddenError('Tenant is not active');
    }

    request.tenantContext = {
      userId,
      tenantId,
      role: 'SUPER_ADMIN',
      isSuperAdmin: true,
    };
    return;
  }

  // Regular users: validate membership
  const membership = await prisma.userTenant.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    include: { tenant: { select: { status: true } } },
  });

  if (!membership) {
    throw new ForbiddenError('You do not have access to this tenant');
  }

  if (membership.tenant.status !== 'ACTIVE') {
    throw new ForbiddenError('Tenant is not active');
  }

  request.tenantContext = {
    userId,
    tenantId,
    role: membership.role as 'ADMIN' | 'OPERATOR',
    isSuperAdmin: false,
  };
}
