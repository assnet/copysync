import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { AffiliateProvider } from '../../domain/enums/AffiliateProvider';
import type { ISecretCipher } from '../../../../shared/security/ISecretCipher';
import type { AffiliateSessionSecret, ResolvedAffiliateCredential } from '../dtos/AffiliateCredentialDTO';
import { affiliateCipherAad } from './affiliateCipherAad';
import { providerRequiresSecret } from '../../domain/services/affiliateProviderFields';

/**
 * Único ponto que entrega segredo decifrado para uso. Sem rota HTTP: o Gerador de ofertas
 * injeta este use case. Credencial inativa, só com sessão (sem ID) ou sem o segredo que o
 * provider exige = null.
 */
export class ResolveAffiliateCredentialUseCase {
  constructor(
    private readonly repo: IAffiliateCredentialRepository,
    private readonly cipher: () => ISecretCipher,
  ) {}

  async execute(tenantId: string, provider: AffiliateProvider): Promise<ResolvedAffiliateCredential | null> {
    const record = await this.repo.findActiveByTenantAndProvider(tenantId, provider);
    if (!record?.publicIdentifier) return null;
    if (providerRequiresSecret(provider) && !record.secret) return null;

    const secret = record.secret
      ? this.cipher().decrypt(record.secret, affiliateCipherAad(tenantId, provider, 'secret'))
      : null;
    const session = record.session
      ? (JSON.parse(
          this.cipher().decrypt(record.session, affiliateCipherAad(tenantId, provider, 'session')),
        ) as AffiliateSessionSecret)
      : null;

    return { provider, publicIdentifier: record.publicIdentifier, secret, session };
  }
}
