import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { AffiliateCredentialNotFoundError } from '../../../../shared/errors/internal/AffiliateCredentialErrors';
import type { AffiliateCredentialKeyInput } from '../dtos/AffiliateCredentialDTO';

/** Apaga a linha inteira, sessão da extensão inclusive. */
export class DeleteAffiliateCredentialUseCase {
  constructor(
    private readonly repo: IAffiliateCredentialRepository,
    private readonly auditRepo: IAuditLogRepository,
  ) {}

  async execute(input: AffiliateCredentialKeyInput): Promise<void> {
    const deleted = await this.repo.delete(input.tenantId, input.provider);
    if (!deleted) throw new AffiliateCredentialNotFoundError(input.provider);

    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'AFFILIATE_CREDENTIAL_DELETED',
      meta: { provider: input.provider },
    });
  }
}
