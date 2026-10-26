import type { TransactionClient } from '../../../../shared/database/UnitOfWork';
import { UnitOfWork } from '../../../../shared/database/UnitOfWork';
import { PrismaUserRepository } from '../../infrastructure/repositories/PrismaUserRepository';
import { PrismaUserInviteRepository } from '../../infrastructure/repositories/PrismaUserInviteRepository';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { User } from '../../domain/entities/User';
import { hashInviteToken } from '../../../../shared/utils/generateInviteToken';
import { hashPassword } from '../../../../shared/utils/hash';
import { validatePasswordPolicy } from '../../../../shared/utils/passwordPolicy';
import { normalizeEmail } from '../../../../shared/utils/normalizeEmail';
import { InviteInvalidError, AlreadyMemberError } from '../../../../shared/errors/internal/TeamErrors';
import { UnauthorizedError } from '../../../../shared/errors/internal/AuthErrors';
import { randomUUID } from 'node:crypto';

export interface AcceptInviteInput {
  token: string;
  password?: string;
  confirmPassword?: string;
  authenticatedUserId?: string;
}

export type AcceptInviteResult =
  | { status: 'ACCEPTED'; tenantId: string; userId: string; isNewUser: boolean }
  | { status: 'REQUIRES_LOGIN'; email: string; hint: string };

export class AcceptInviteUseCase {
  async execute(input: AcceptInviteInput): Promise<AcceptInviteResult> {
    const tokenHash = hashInviteToken(input.token);
    const uow = new UnitOfWork();

    return uow.runInTransaction(async (tx: TransactionClient) => {
      const inviteRepo = new PrismaUserInviteRepository(tx);
      const userRepo = new PrismaUserRepository(tx);
      const auditRepo = new PrismaAuditLogRepository(tx);

      const invite = await inviteRepo.findByTokenHash(tokenHash);
      if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
        throw new InviteInvalidError();
      }

      const email = normalizeEmail(invite.email);
      const existingUser = await userRepo.findByEmail(email);

      // Path 3: existing user WITH password → must be authenticated
      if (existingUser?.hasPassword()) {
        if (!input.authenticatedUserId) {
          return { status: 'REQUIRES_LOGIN' as const, email, hint: 'LOGIN_REQUIRED' };
        }
        if (input.authenticatedUserId !== existingUser.id) {
          throw new UnauthorizedError('Authenticated user does not match invite email');
        }

        const tenants = await userRepo.findTenantsForUser(existingUser.id);
        if (tenants.some((t) => t.tenantId === invite.tenantId)) {
          throw new AlreadyMemberError();
        }

        await userRepo.createUserTenant({
          userId: existingUser.id,
          tenantId: invite.tenantId,
          role: invite.role,
        });
        await inviteRepo.markAccepted(invite.id);

        await auditRepo.create({
          tenantId: invite.tenantId,
          userId: existingUser.id,
          action: 'INVITE_ACCEPTED',
          meta: { inviteId: invite.id, path: 'EXISTING_AUTHENTICATED' },
        });

        return { status: 'ACCEPTED' as const, tenantId: invite.tenantId, userId: existingUser.id, isNewUser: false };
      }

      // Path 2b: existing user WITHOUT password but has OTHER tenant links → requires login hint
      if (existingUser && !existingUser.hasPassword()) {
        const tenants = await userRepo.findTenantsForUser(existingUser.id);
        if (tenants.some((t) => t.tenantId === invite.tenantId)) {
          throw new AlreadyMemberError();
        }

        if (tenants.length > 0 && !input.authenticatedUserId) {
          return { status: 'REQUIRES_LOGIN' as const, email, hint: 'SET_PASSWORD_FIRST' };
        }
      }

      // Path 1 (new user) or Path 2 (existing without password, no other tenant)
      if (!input.password || !input.confirmPassword) {
        throw new InviteInvalidError();
      }

      validatePasswordPolicy(input.password);

      if (input.password !== input.confirmPassword) {
        const { PasswordMismatchError } = await import('../../../../shared/errors/internal/AuthErrors');
        throw new PasswordMismatchError();
      }

      const passwordHash = await hashPassword(input.password);
      const now = new Date();
      let userId: string;

      if (existingUser) {
        // Path 2: set password on existing user
        userId = existingUser.id;
        const updated = new User({
          id: existingUser.id,
          email: existingUser.email,
          passwordHash,
          passwordSetAt: now,
          mustChangePassword: false,
          name: existingUser.name,
          isSuperAdmin: existingUser.isSuperAdmin,
          createdAt: existingUser.createdAt,
          updatedAt: now,
        });
        await userRepo.update(updated);

        const tenants = await userRepo.findTenantsForUser(existingUser.id);
        if (!tenants.some((t) => t.tenantId === invite.tenantId)) {
          await userRepo.createUserTenant({
            userId: existingUser.id,
            tenantId: invite.tenantId,
            role: invite.role,
          });
        }
      } else {
        // Path 1: create new user
        userId = randomUUID();
        const newUser = new User({
          id: userId,
          email,
          passwordHash,
          passwordSetAt: now,
          mustChangePassword: false,
          name: email.split('@')[0],
          isSuperAdmin: false,
          createdAt: now,
          updatedAt: now,
        });
        await userRepo.create(newUser);
        await userRepo.createUserTenant({
          userId,
          tenantId: invite.tenantId,
          role: invite.role,
        });
      }

      await inviteRepo.markAccepted(invite.id);

      await auditRepo.create({
        tenantId: invite.tenantId,
        userId,
        action: 'INVITE_ACCEPTED',
        meta: { inviteId: invite.id, path: existingUser ? 'EXISTING_SET_PASSWORD' : 'NEW_USER' },
      });

      return { status: 'ACCEPTED' as const, tenantId: invite.tenantId, userId, isNewUser: !existingUser };
    });
  }
}
