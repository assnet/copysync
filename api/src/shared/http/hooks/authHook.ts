import type { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError } from '../../errors/internal/AuthErrors';

/**
 * Fastify preHandler — validates the Bearer JWT and populates request.user.
 * Apply this hook to any route requiring authentication.
 * @fastify/jwt sets request.user automatically after jwtVerify().
 */
export async function authHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw new UnauthorizedError('Invalid or expired access token');
  }
}
