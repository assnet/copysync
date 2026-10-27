import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { AffiliateCredentialKeyInput } from '../dtos/AffiliateCredentialDTO';

/** Desconecta a sessão do marketplace: apaga o blob cifrado, mantém ID público e secreto. Idempotente. */
export class ClearAffiliateSessionUseCase {
  constructor(
    private readonly repo: IAffiliateCredentialRepository,
    private readonly auditRepo: IAuditLogRepository,
  ) {}

  async execute(input: AffiliateCredentialKeyInput): Promise<void> {
    const cleared = await this.repo.clearSession(input.tenantId, input.provider);
    if (!cleared) return;

    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'AFFILIATE_SESSION_ACCOUNT_RESET',
      meta: { provider: input.provider, reason: 'disconnect' },
    });
  }
}
