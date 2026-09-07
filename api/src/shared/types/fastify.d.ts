import type { TenantContext } from './TenantContext';

/**
 * Augments @fastify/jwt so that jwtVerify / jwtSign use our token shape.
 * After `await request.jwtVerify()`, `request.user` is typed as:
 *   { userId: string; isSuperAdmin: boolean }
 */
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string; isSuperAdmin: boolean; tenantId?: string };
    user: { userId: string; isSuperAdmin: boolean; tenantId?: string };
  }
}

/**
 * Adds tenantContext to every Fastify request.
 * Populated by tenantHook on routes that require tenant scope.
 */
declare module 'fastify' {
  interface FastifyRequest {
    tenantContext: TenantContext;
  }
}
