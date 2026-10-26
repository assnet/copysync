import crypto from 'node:crypto';
import type { IUserRepository } from '../../domain/contracts/IUserRepository';
import type { IUserInviteRepository } from '../../domain/contracts/IUserInviteRepository';
import type { IEmailSender } from '../../../integrations/domain/contracts/IEmailSender';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { normalizeEmail } from '../../../../shared/utils/normalizeEmail';
import { generateInviteToken } from '../../../../shared/utils/generateInviteToken';
import { AlreadyMemberError } from '../../../../shared/errors/internal/TeamErrors';
import { env } from '../../../../shared/config/env';

const INVITE_EXPIRY_DAYS = 7;
const INVITE_RETENTION_DAYS = 30;

export interface InviteUserInput {
  tenantId: string;
  email: string;
  role: 'ADMIN' | 'OPERATOR';
  invitedById?: string;
}

export interface InviteUserOutput {
  inviteId: string;
  inviteLink: string;
  emailSent: boolean;
}

export class InviteUserUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly inviteRepo: IUserInviteRepository,
    private readonly auditLogRepo: IAuditLogRepository,
    private readonly emailSender: IEmailSender,
  ) {}

  async execute(input: InviteUserInput): Promise<InviteUserOutput> {
    const email = normalizeEmail(input.email);

    const existingUser = await this.userRepo.findByEmail(email);
    if (existingUser) {
      const memberships = await this.userRepo.findTenantsForUser(existingUser.id);
      const isActiveMember = memberships.some(
        (m) => m.tenantId === input.tenantId,
      );
      if (isActiveMember) throw new AlreadyMemberError();
    }

    await this.inviteRepo.expirePreviousInvites(input.tenantId, email);

    const { token, tokenHash } = generateInviteToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

    const invite = await this.inviteRepo.create({
      id: crypto.randomUUID(),
      tenantId: input.tenantId,
      email,
      role: input.role,
      tokenHash,
      expiresAt,
      acceptedAt: null,
      invitedById: input.invitedById ?? null,
    });

    await this.auditLogRepo.create({
      tenantId: input.tenantId,
      userId: input.invitedById,
      action: 'MEMBER_INVITED',
      meta: { email, role: input.role },
    });

    const inviteLink = env.PANEL_URL
      ? `${env.PANEL_URL}/invite/${token}`
      : `/invite/${token}`;

    let emailSent = false;
    try {
      const result = await this.emailSender.send({
        to: email,
        template: 'TEAM_INVITE',
        data: { link: inviteLink, expiresAt: expiresAt.toISOString() },
      });
      emailSent = result.sent;
    } catch {
      emailSent = false;
    }

    void this.inviteRepo.cleanupOldInvites(input.tenantId, email, INVITE_RETENTION_DAYS).catch(() => {});

    return { inviteId: invite.id, inviteLink, emailSent };
  }
}
