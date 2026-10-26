import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { superAdminHook } from '../../../../shared/http/hooks/superAdminHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { ProvisionTenantUseCase } from '../../application/use-cases/ProvisionTenantUseCase';
import { UpdateTenantStatusUseCase } from '../../application/use-cases/UpdateTenantStatusUseCase';
import { InviteUserUseCase } from '../../../users/application/use-cases/InviteUserUseCase';
import { PrismaTenantRepository } from '../../infrastructure/repositories/PrismaTenantRepository';
import { PrismaUserRepository } from '../../../users/infrastructure/repositories/PrismaUserRepository';
import { PrismaUserInviteRepository } from '../../../users/infrastructure/repositories/PrismaUserInviteRepository';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { createEmailSender } from '../../../integrations/infrastructure/email/EmailSenderFactory';
import { env } from '../../../../shared/config/env';
import type { TenantStatus } from '../../domain/entities/Tenant';

export async function provisioningRoutes(app: FastifyInstance): Promise<void> {
  const preHandler = [authHook, superAdminHook];

  // ── POST /provisioning/tenants ── create tenant + admin ───────────────────
  app.post(
    '/tenants',
    {
      preHandler,
      schema: {
        tags: ['Provisioning'],
        summary: 'Provisionar novo tenant',
        body: {
          type: 'object',
          required: ['name', 'slug', 'owner'],
          properties: {
            name: { type: 'string', minLength: 1 },
            slug: { type: 'string', minLength: 1, pattern: '^[a-z0-9-]+$' },
            owner: {
              type: 'object',
              required: ['email', 'name'],
              properties: {
                email: { type: 'string', format: 'email' },
                name: { type: 'string', minLength: 1 },
              },
            },
            billingCustomerId: { type: 'string' },
            planSlug: { type: 'string' },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  tenantId: { type: 'string' },
                  userId: { type: 'string' },
                  inviteLink: { type: 'string', nullable: true },
                  emailSent: { type: 'boolean' },
                  existingAccount: { type: 'boolean' },
                },
              },
            },
          },
          409: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        name: string;
        slug: string;
        owner: { email: string; name: string };
        billingCustomerId?: string;
        planSlug?: string;
      };

      const emailSender = createEmailSender({ mode: env.EMAIL_SENDER, smtpUrl: env.EMAIL_SMTP_URL, from: env.EMAIL_FROM });
      const useCase = new ProvisionTenantUseCase(emailSender);
      const result = await useCase.execute({
        ...body,
        origin: 'SUPER_ADMIN',
      });

      httpResponse.created(reply, result);
    },
  );

  // ── PATCH /provisioning/tenants/:id/status ── change tenant status ────────
  app.patch(
    '/tenants/:id/status',
    {
      preHandler,
      schema: {
        tags: ['Provisioning'],
        summary: 'Alterar status do tenant',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'CANCELLED'] },
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
                  id: { type: 'string' },
                  status: { type: 'string' },
                },
              },
            },
          },
          404: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { status } = request.body as { status: TenantStatus };

      const tenantRepo = new PrismaTenantRepository();
      const auditRepo = new PrismaAuditLogRepository();
      const useCase = new UpdateTenantStatusUseCase(tenantRepo, auditRepo);
      const updated = await useCase.execute({
        tenantId: id,
        status,
        origin: 'SUPER_ADMIN',
      });

      httpResponse.ok(reply, { id: updated?.id, status: updated?.status });
    },
  );

  // ── POST /provisioning/tenants/:id/first-access-link ── generate invite ───
  app.post(
    '/tenants/:id/first-access-link',
    {
      preHandler,
      schema: {
        tags: ['Provisioning'],
        summary: 'Gerar link de primeiro acesso para admin do tenant',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['ADMIN', 'OPERATOR'], default: 'ADMIN' },
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
                  inviteId: { type: 'string' },
                  inviteLink: { type: 'string' },
                  emailSent: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { email: string; role?: 'ADMIN' | 'OPERATOR' };

      const emailSender = createEmailSender({ mode: env.EMAIL_SENDER, smtpUrl: env.EMAIL_SMTP_URL, from: env.EMAIL_FROM });
      const useCase = new InviteUserUseCase(
        new PrismaUserRepository(),
        new PrismaUserInviteRepository(),
        new PrismaAuditLogRepository(),
        emailSender,
      );

      const result = await useCase.execute({
        tenantId: id,
        email: body.email,
        role: body.role ?? 'ADMIN',
      });

      httpResponse.ok(reply, result);
    },
  );
}
