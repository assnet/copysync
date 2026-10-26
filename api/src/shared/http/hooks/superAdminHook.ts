import type { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError } from '../../errors/internal/AuthErrors';

export async function superAdminHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const user = (request as any).user as { isSuperAdmin?: boolean } | undefined;
  if (!user?.isSuperAdmin) {
    throw new UnauthorizedError('Super admin access required');
  }
}
