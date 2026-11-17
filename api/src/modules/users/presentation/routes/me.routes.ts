import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { PrismaUserRepository } from '../../infrastructure/repositories/PrismaUserRepository';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { ChangePasswordUseCase } from '../../application/use-cases/ChangePasswordUseCase';
import { changePasswordBodySchema } from '../schemas/change-password.schema';
import type { ChangePasswordInputDto } from '../../application/dtos/ChangePasswordInputDto';
import { GetCheckoutPrefillUseCase } from '../../application/use-cases/GetCheckoutPrefillUseCase';
import { CheckoutPrefillPresenter } from '../presenters/CheckoutPrefillPresenter';
import { ListUserTenantsUseCase } from '../../../tenants/application/use-cases/ListUserTenantsUseCase';
import { TenantPresenter } from '../../../tenants/presentation/presenters/TenantPresenter';
import { productAccessReader } from '../../../tenants/infrastructure/productAccessContainer';

const userRepo = new PrismaUserRepository();
const changePasswordUseCase = new ChangePasswordUseCase(userRepo);
const checkoutPrefillUseCase = new GetCheckoutPrefillUseCase(userRepo);
const listUserTenantsUseCase = new ListUserTenantsUseCase(userRepo, productAccessReader);

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
          // Envelope `{ success, data }` do `httpResponse.ok` (sem ele o serializador devolvia `{}`).
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  isSuperAdmin: { type: 'boolean' },
                  tenants: { type: 'array', items: { $ref: 'TenantItem#' } },
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

      const { tenants } = await listUserTenantsUseCase.execute({ userId });

      httpResponse.ok(reply, {
        id: user.id,
        name: user.name,
        email: user.email,
        isSuperAdmin: user.isSuperAdmin,
        tenants: tenants.map(TenantPresenter.toTenantItem),
      });
    },
  );

  app.patch(
    '/password',
    {
      preHandler: [authHook],
      schema: {
        tags: ['Me'],
        summary: 'Alterar senha do usuário autenticado',
        description: 'Atualiza a senha do usuário logado. Requer nova senha e confirmação.',
        security: [{ bearerAuth: [] }],
        body: changePasswordBodySchema,
        response: {
          204: { type: 'null', description: 'Senha alterada com sucesso.' },
          400: { $ref: 'ErrorResponse#' },
          401: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.user;
      const input = request.body as ChangePasswordInputDto;
      await changePasswordUseCase.execute(userId, input);
      httpResponse.noContent(reply);
    },
  );

  // Autopreenchimento do link de pagamento (docs/planos.md). Dado pessoal: no-store e nunca logar.
  app.get(
    '/checkout-prefill',
    {
      preHandler: [authHook],
      schema: {
        tags: ['Me'],
        summary: 'Dados para autopreencher o link de pagamento',
        description: 'E-mail e nome do usuário autenticado, só quando válidos para o formulário de pagamento. Chave inválida é omitida.',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  email: { type: 'string' },
                  confirmEmail: { type: 'string' },
                  name: { type: 'string' },
                },
              },
            },
          },
          401: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const prefill = await checkoutPrefillUseCase.execute(request.user.userId);
      reply.header('Cache-Control', 'no-store');
      httpResponse.ok(reply, CheckoutPrefillPresenter.toResponse(prefill));
    },
  );
}
