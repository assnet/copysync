import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { ListUserTenantsUseCase } from '../../application/use-cases/ListUserTenantsUseCase';
import { SwitchTenantUseCase } from '../../application/use-cases/SwitchTenantUseCase';
import { TenantPresenter } from '../presenters/TenantPresenter';
import { PrismaUserRepository } from '../../../users/infrastructure/repositories/PrismaUserRepository';

const userRepo = new PrismaUserRepository();
const listUserTenantsUseCase = new ListUserTenantsUseCase(userRepo);
const switchTenantUseCase = new SwitchTenantUseCase(userRepo);

const switchBodySchema = {
  type: 'object',
  required: ['tenantId'],
  properties: {
    tenantId: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const;

/**
 * Tenant routes — all require authentication, no tenant scope.
 * Registered under /api/tenants.
 */
export async function tenantRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /tenants — list tenants the current user belongs to ───────────────
  app.get(
    '/',
    {
      preHandler: [authHook],
      schema: {
        tags: ['Tenants'],
        summary: 'Listar tenants do usuário',
        description: 'Retorna todos os tenants aos quais o usuário autenticado pertence.',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'array',
            items: { $ref: 'TenantItem#' },
          },
          401: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user;
      const result = await listUserTenantsUseCase.execute({ userId });
      httpResponse.ok(reply, TenantPresenter.toTenantList(result.tenants));
    },
  );

  // ── POST /tenants/switch — validate & switch active tenant ────────────────
  app.post(
    '/switch',
    {
      preHandler: [authHook],
      schema: {
        tags: ['Tenants'],
        summary: 'Trocar tenant ativo',
        description: 'Valida se o usuário pertence ao tenant informado e retorna um novo access token com o contexto de tenant.',
        security: [{ bearerAuth: [] }],
        body: switchBodySchema,
        response: {
          200: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              tenantId: { type: 'string' },
              tenantName: { type: 'string' },
            },
          },
          401: { $ref: 'ErrorResponse#' },
          403: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.body as { tenantId: string };
      const { userId } = request.user;

      const result = await switchTenantUseCase.execute({ userId, targetTenantId: tenantId });
      httpResponse.ok(reply, TenantPresenter.toSwitchResult(result));
    },
  );
}
