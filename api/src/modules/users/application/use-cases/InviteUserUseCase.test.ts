import { describe, expect, it, vi } from 'vitest';
import { InviteUserUseCase } from './InviteUserUseCase';
import type { IUserRepository } from '../../domain/contracts/IUserRepository';
import type { IUserInviteRepository } from '../../domain/contracts/IUserInviteRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { ITenantRepository } from '../../../tenants/domain/contracts/ITenantRepository';
import type { IEmailSender } from '../../../integrations/domain/contracts/IEmailSender';

function build(opts: { tenantName?: string; inviterName?: string; withTenantRepo?: boolean } = {}) {
  const userRepo = {
    findByEmail: vi.fn().mockResolvedValue(null),
    findTenantsForUser: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(opts.inviterName ? { name: opts.inviterName } : null),
  } as unknown as IUserRepository;
  const inviteRepo = {
    expirePreviousInvites: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockImplementation(async (d) => ({ ...d, createdAt: new Date() })),
    cleanupOldInvites: vi.fn().mockResolvedValue(undefined),
  } as unknown as IUserInviteRepository;
  const audit = { create: vi.fn().mockResolvedValue(undefined) } as unknown as IAuditLogRepository;
  const send = vi.fn().mockResolvedValue({ sent: true });
  const tenantRepo = { findById: vi.fn().mockResolvedValue(opts.tenantName ? { name: opts.tenantName } : null) } as unknown as ITenantRepository;
  const uc = new InviteUserUseCase(userRepo, inviteRepo, audit, { send } as IEmailSender, opts.withTenantRepo === false ? undefined : tenantRepo);
  return { uc, send };
}

describe('InviteUserUseCase — e-mail TEAM_INVITE', () => {
  it('envia nome do tenant e de quem convidou', async () => {
    const { uc, send } = build({ tenantName: 'Loja da Ana', inviterName: 'Bia' });
    await uc.execute({ tenantId: 't1', email: 'C@X.com', role: 'OPERATOR', invitedById: 'u1' });
    const { to, template, data } = send.mock.calls[0][0];
    expect(to).toBe('c@x.com');
    expect(template).toBe('TEAM_INVITE');
    expect(data).toMatchObject({ tenantName: 'Loja da Ana', inviterName: 'Bia' });
    expect(data.link).toMatch(/\/invite\//);
    expect(typeof data.expiresAt).toBe('string');
  });

  it('sem quem convidou nem repo de tenant: omite as chaves', async () => {
    const { uc, send } = build({ withTenantRepo: false });
    await uc.execute({ tenantId: 't1', email: 'c@x.com', role: 'ADMIN' });
    const { data } = send.mock.calls[0][0];
    expect(data).not.toHaveProperty('tenantName');
    expect(data).not.toHaveProperty('inviterName');
  });
});
