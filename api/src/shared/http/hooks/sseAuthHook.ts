import type { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError } from '../../errors/internal/AuthErrors';
import { resolveMembership } from './resolveMembership';

/**
 * Combined auth + tenant preHandler for SSE/WS endpoints.
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

  request.tenantContext = await resolveMembership(userId, tenantId, isSuperAdmin);
}
