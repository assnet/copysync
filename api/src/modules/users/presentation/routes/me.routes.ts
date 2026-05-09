import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { PrismaUserRepository } from '../../infrastructure/repositories/PrismaUserRepository';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';

const userRepo = new PrismaUserRepository();

/**
 * /me route — returns the authenticated user's profile and tenant memberships.
 * Requires authentication, no tenant scope.
 * Registered under /api/me.
 */
export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    {
      preHandler: [authHook],
      schema: {
        tags: ['Me'],
        summary: 'Perfil do usuário autenticado',
        description: 'Retorna os dados do usuário autenticado e os tenants aos quais ele pertence.',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
              isSuperAdmin: { type: 'boolean' },
              tenants: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    slug: { type: 'string' },
                    role: { type: 'string' },
                    status: { type: 'string' },
                  },
                },
              },
            },
          },
          401: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user;

      const user = await userRepo.findById(userId);
      if (!user) throw new NotFoundError('User', userId);

      const tenants = await userRepo.findTenantsForUser(userId);

      httpResponse.ok(reply, {
        id: user.id,
        name: user.name,
        email: user.email,
        isSuperAdmin: user.isSuperAdmin,
        tenants: tenants.map((t) => ({
          id: t.tenantId,
          name: t.tenantName,
          slug: t.tenantSlug,
          role: t.role,
          status: t.tenantStatus,
        })),
      });
    },
  );
}
