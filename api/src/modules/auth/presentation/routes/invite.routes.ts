import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { optionalAuthHook } from '../../../../shared/http/hooks/optionalAuthHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { hashInviteToken } from '../../../../shared/utils/generateInviteToken';
import { PrismaUserInviteRepository } from '../../../users/infrastructure/repositories/PrismaUserInviteRepository';
import { PrismaUserRepository } from '../../../users/infrastructure/repositories/PrismaUserRepository';
import { PrismaTenantRepository } from '../../../tenants/infrastructure/repositories/PrismaTenantRepository';
import { AcceptInviteUseCase } from '../../../users/application/use-cases/AcceptInviteUseCase';
import { InviteInvalidError } from '../../../../shared/errors/internal/TeamErrors';

const inviteRepo = new PrismaUserInviteRepository();
const userRepo = new PrismaUserRepository();
const tenantRepo = new PrismaTenantRepository();
const acceptInviteUseCase = new AcceptInviteUseCase();

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /auth/invites/:token ── public invite info ─────────────────────────
  app.get(
    '/invites/:token',
    {
      schema: {
        tags: ['Invites'],
        summary: 'Informações do convite',
        params: {
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string', minLength: 1 } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                  tenantName: { type: 'string' },
                  role: { type: 'string' },
                  expiresAt: { type: 'string', format: 'date-time' },
                  requiresPassword: { type: 'boolean' },
                  requiresLogin: { type: 'boolean' },
                },
              },
            },
          },
          404: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
      const tokenHash = hashInviteToken(request.params.token);
      const invite = await inviteRepo.findByTokenHash(tokenHash);

      if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
        throw new InviteInvalidError();
      }

      const user = await userRepo.findByEmail(invite.email);
      const hasPassword = user?.hasPassword() ?? false;
      let requiresLogin = false;

      if (user && !hasPassword) {
        const tenants = await userRepo.findTenantsForUser(user.id);
        requiresLogin = tenants.length > 0;
      }

      const tenant = await tenantRepo.findById(invite.tenantId);
      const tenantName = tenant?.name ?? invite.tenantId;

      httpResponse.ok(reply, {
        email: invite.email,
        tenantName,
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
        requiresPassword: !hasPassword,
        requiresLogin: hasPassword || requiresLogin,
      });
    },
  );

  // ── POST /auth/invites/:token/accept ── accept invite ─────────────────────
  app.post(
    '/invites/:token/accept',
    {
      preHandler: [optionalAuthHook],
      schema: {
        tags: ['Invites'],
        summary: 'Aceitar convite',
        params: {
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string', minLength: 1 } },
        },
        body: {
          type: 'object',
          properties: {
            password: { type: 'string', minLength: 8 },
            confirmPassword: { type: 'string', minLength: 8 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['ACCEPTED', 'REQUIRES_LOGIN'] },
                  tenantId: { type: 'string' },
                  userId: { type: 'string' },
                  isNewUser: { type: 'boolean' },
                  email: { type: 'string' },
                  hint: { type: 'string' },
                },
              },
            },
          },
          404: { $ref: 'ErrorResponse#' },
          409: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { token: string };
      const body = (request.body ?? {}) as { password?: string; confirmPassword?: string };
      const jwtPayload = (request as any).user as { userId: string } | undefined;

      const result = await acceptInviteUseCase.execute({
        token: params.token,
        password: body.password,
        confirmPassword: body.confirmPassword,
        authenticatedUserId: jwtPayload?.userId,
      });

      httpResponse.ok(reply, result);
    },
  );
}
