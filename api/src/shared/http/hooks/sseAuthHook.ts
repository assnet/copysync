import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../database/prisma.client';
import { UnauthorizedError, ForbiddenError } from '../../errors/internal/AuthErrors';

/**
 * Combined auth + tenant preHandler for SSE endpoints.
 *
 * EventSource (browser) cannot set custom headers, so the JWT token and
 * tenantId must arrive via query string parameters:
 *   GET /events?token=<jwt>&tenantId=<id>
 *
 * This hook mirrors the logic of authHook + tenantHook but reads from
 * query params instead of headers.
 */
export async function sseAuthHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const qs = request.query as Record<string, string | undefined>;
  const token = qs['token'];
  const tenantId = qs['tenantId'];

  if (!token) throw new UnauthorizedError('Missing token query parameter');
  if (!tenantId) throw new UnauthorizedError('Missing tenantId query parameter');

  // Verify JWT using fastify-jwt by injecting it into the Authorization header
  request.headers['authorization'] = `Bearer ${token}`;
  try {
    await request.jwtVerify();
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }

  const { userId, isSuperAdmin } = request.user;

  if (isSuperAdmin) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true },
    });
    if (!tenant) throw new ForbiddenError(`Tenant not found: ${tenantId}`);
    if (tenant.status !== 'ACTIVE') throw new ForbiddenError('Tenant is not active');

    request.tenantContext = { userId, tenantId, role: 'SUPER_ADMIN', isSuperAdmin: true };
    return;
  }

  const membership = await prisma.userTenant.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    include: { tenant: { select: { status: true } } },
  });
  if (!membership) throw new ForbiddenError('You do not have access to this tenant');
  if (membership.tenant.status !== 'ACTIVE') throw new ForbiddenError('Tenant is not active');

  request.tenantContext = {
    userId,
    tenantId,
    role: membership.role as 'ADMIN' | 'OPERATOR',
    isSuperAdmin: false,
  };
}
