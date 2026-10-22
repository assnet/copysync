import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { AffiliateCredential } from '../../domain/entities/AffiliateCredential';
import { AffiliateCredentialNotFoundError } from '../../../../shared/errors/internal/AffiliateCredentialErrors';
import type { SetAffiliateCredentialStatusInput } from '../dtos/AffiliateCredentialDTO';

/** Pausa ou reativa sem apagar a chave. */
export class SetAffiliateCredentialStatusUseCase {
  constructor(private readonly repo: IAffiliateCredentialRepository) {}

  async execute(input: SetAffiliateCredentialStatusInput): Promise<AffiliateCredential> {
    const credential = await this.repo.setStatus(input.tenantId, input.provider, input.status);
    if (!credential) throw new AffiliateCredentialNotFoundError(input.provider);
    return credential;
  }
}
