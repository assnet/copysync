import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Like authHook, but doesn't fail when the Authorization header is missing.
 * If the header IS present but invalid → 401 (never treat as anonymous by mistake).
 * Sets request.user when valid; leaves it undefined otherwise.
 */
export async function optionalAuthHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header) return;

  await request.jwtVerify();
}
