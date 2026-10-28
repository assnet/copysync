import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { AffiliateProvider } from '../../domain/enums/AffiliateProvider';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';

/**
 * A loja recusou a credencial no uso (401/403 no link do monitoramento): grava a rejeição e audita.
 * Só `provider` e `code` na auditoria: nunca corpo da resposta, cookie ou chave.
 */
export class MarkAffiliateCredentialRejectedUseCase {
  constructor(
    private readonly repo: IAffiliateCredentialRepository,
    private readonly auditRepo: IAuditLogRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(tenantId: string, provider: AffiliateProvider, code: string): Promise<void> {
    await this.repo.markRejected(tenantId, provider, code, this.now());
    await this.auditRepo.create({ tenantId, action: 'AFFILIATE_CREDENTIAL_REJECTED', meta: { provider, code } });
  }
}
