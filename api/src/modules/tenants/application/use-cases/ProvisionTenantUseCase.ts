import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { TransactionClient } from '../../../../shared/database/UnitOfWork';
import { UnitOfWork } from '../../../../shared/database/UnitOfWork';
import { PrismaTenantRepository } from '../../infrastructure/repositories/PrismaTenantRepository';
import { PrismaUserRepository } from '../../../users/infrastructure/repositories/PrismaUserRepository';
import { PrismaUserInviteRepository } from '../../../users/infrastructure/repositories/PrismaUserInviteRepository';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { Tenant } from '../../domain/entities/Tenant';
import { User } from '../../../users/domain/entities/User';
import type { IEmailSender } from '../../../integrations/domain/contracts/IEmailSender';
import { normalizeEmail } from '../../../../shared/utils/normalizeEmail';
import { generateInviteToken } from '../../../../shared/utils/generateInviteToken';
import { SlugTakenError } from '../../../../shared/errors/internal/TeamErrors';
import { env } from '../../../../shared/config/env';
import { logger } from '../../../../shared/logger/logger';

export type ProvisionOrigin = 'SUPER_ADMIN' | 'BILLING_WEBHOOK';

export interface ProvisionTenantInput {
  name: string;
  slug: string;
  owner: { email: string; name: string };
  billingCustomerId?: string;
  planSlug?: string;
  origin: ProvisionOrigin;
}

export interface ProvisionTenantOutput {
  tenantId: string;
  userId: string;
  inviteLink: string | null;
  emailSent: boolean;
  existingAccount: boolean;
}

export class ProvisionTenantUseCase {
  constructor(private readonly emailSender: IEmailSender) {}

  async execute(input: ProvisionTenantInput): Promise<ProvisionTenantOutput> {
    const uow = new UnitOfWork();
    const email = normalizeEmail(input.owner.email);
    let inviteLink: string | null = null;
    let emailSent = false;
    let existingAccount = false;
    let tenantId = '';
    let userId = '';

    try {
      const result = await uow.runInTransaction(async (tx: TransactionClient) => {
        const tenantRepo = new PrismaTenantRepository(tx);
        const userRepo = new PrismaUserRepository(tx);
        const inviteRepo = new PrismaUserInviteRepository(tx);
        const auditRepo = new PrismaAuditLogRepository(tx);

        // 1. Create Tenant
        const now = new Date();
        tenantId = randomUUID();
        const tenant = new Tenant({
          id: tenantId,
          name: input.name,
          slug: input.slug,
          status: 'ACTIVE',
          billingCustomerId: input.billingCustomerId ?? null,
          planSlug: input.planSlug ?? null,
          lastBillingEventSeq: null,
          suspendedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        await tenantRepo.create(tenant);

        // 2. Find or create User
        let user = await userRepo.findByEmail(email);
        let isNewUser = false;

        if (!user) {
          isNewUser = true;
          userId = randomUUID();
          user = new User({
            id: userId,
            email,
            passwordHash: null,
            passwordSetAt: null,
            mustChangePassword: false,
            name: input.owner.name,
            isSuperAdmin: false,
            createdAt: now,
            updatedAt: now,
          });
          await userRepo.create(user);
        } else {
          userId = user.id;
          if (user.hasPassword()) {
            existingAccount = true;
          }
        }

        // 3. Create UserTenant (ADMIN)
        await userRepo.createUserTenant({
          userId: user.id,
          tenantId,
          role: 'ADMIN',
        });

        // 4. Create UserInvite for first access (only if no password)
        if (!existingAccount) {
          const { token, tokenHash } = generateInviteToken();
          const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

          await inviteRepo.create({
            id: randomUUID(),
            tenantId,
            email,
            role: 'ADMIN',
            tokenHash,
            expiresAt,
            acceptedAt: null,
            invitedById: null,
          });

          inviteLink = env.PANEL_URL
            ? `${env.PANEL_URL}/invite/${token}`
            : null;

          // Email in afterCommit
          if (inviteLink) {
            uow.afterCommit(async () => {
              const result = await this.emailSender.send({
                to: email,
                template: 'SET_PASSWORD',
                data: {
                  name: input.owner.name,
                  link: inviteLink!,
                  expiresAt: expiresAt.toISOString(),
                },
              });
              emailSent = result.sent;
            });
          }
        }

        // 5. AuditLog
        await auditRepo.create({
          tenantId,
          userId: user.id,
          action: 'TENANT_CREATED',
          meta: { origin: input.origin, ownerEmail: email },
        });

        return { tenantId, userId };
      });

      tenantId = result.tenantId;
      userId = result.userId;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = (err.meta as any)?.target;
        if (Array.isArray(target) && target.includes('slug') || String(target).includes('slug')) {
          throw new SlugTakenError();
        }
      }
      throw err;
    }

    return { tenantId, userId, inviteLink, emailSent, existingAccount };
  }
}
