import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { AffiliateCredential } from '../../domain/entities/AffiliateCredential';

/** Lista as credenciais do tenant. Não usa a cifra: responde mesmo sem chave configurada. */
export class ListAffiliateCredentialsUseCase {
  constructor(private readonly repo: IAffiliateCredentialRepository) {}

  execute(tenantId: string): Promise<AffiliateCredential[]> {
    return this.repo.listByTenant(tenantId);
  }
}
