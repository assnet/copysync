import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { AffiliateCredential } from '../../domain/entities/AffiliateCredential';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { ISecretCipher } from '../../../../shared/security/ISecretCipher';
import {
  providerRequiresSecret,
  providerUsesSession,
  validatePublicIdentifier,
  validateSecret,
} from '../../domain/services/affiliateProviderFields';
import { AffiliateCredentialInvalidError } from '../../../../shared/errors/internal/AffiliateCredentialErrors';
import type { UpsertAffiliateCredentialInput } from '../dtos/AffiliateCredentialDTO';
import { affiliateCipherAad } from './affiliateCipherAad';

/**
 * Cadastra ou edita a credencial do painel. Segredo vazio em registro existente mantém o atual.
 * A cifra só é pedida quando há segredo a gravar: sem chave, quem não tem segredo (ML, Amazon)
 * segue funcionando e nada é gravado em claro.
 */
export class UpsertAffiliateCredentialUseCase {
  constructor(
    private readonly repo: IAffiliateCredentialRepository,
    private readonly cipher: () => ISecretCipher,
    private readonly auditRepo: IAuditLogRepository,
  ) {}

  async execute(input: UpsertAffiliateCredentialInput): Promise<AffiliateCredential> {
    const publicIdentifier = validatePublicIdentifier(input.provider, input.publicIdentifier);
    if (!publicIdentifier) {
      throw new AffiliateCredentialInvalidError('Invalid public identifier', 'publicIdentifier');
    }

    const rawSecret = input.secret?.trim() ?? '';
    let secret: string | null = null;
    if (rawSecret) {
      if (!providerRequiresSecret(input.provider)) {
        throw new AffiliateCredentialInvalidError('Provider does not take a secret', 'secret');
      }
      secret = validateSecret(input.provider, rawSecret);
      if (!secret) throw new AffiliateCredentialInvalidError('Invalid secret', 'secret');
    }

    const existing = await this.repo.findByTenantAndProvider(input.tenantId, input.provider);
    if (!secret && providerRequiresSecret(input.provider) && !existing?.hasSecret) {
      throw new AffiliateCredentialInvalidError('Secret is required', 'secret');
    }

    // Rejeição some só quando o que foi recusado muda (secret novo ou ID diferente). ML pelo painel
    // troca só a etiqueta e a recusa é da sessão (extensão): nunca limpa aqui.
    const clearRejection = !providerUsesSession(input.provider)
      && (secret !== null || existing?.publicIdentifier !== publicIdentifier);

    const credential = await this.repo.upsert({
      tenantId: input.tenantId,
      provider: input.provider,
      publicIdentifier,
      ...(secret && {
        secret: this.cipher().encrypt(secret, affiliateCipherAad(input.tenantId, input.provider, 'secret')),
      }),
      clearRejection,
    });

    await this.auditRepo.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'AFFILIATE_CREDENTIAL_UPSERTED',
      meta: { provider: input.provider, secretChanged: secret !== null },
    });

    return credential;
  }
}
