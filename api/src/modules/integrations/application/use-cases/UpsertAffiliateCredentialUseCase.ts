import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { AffiliateCredential } from '../../domain/entities/AffiliateCredential';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { ISecretCipher } from '../../../../shared/security/ISecretCipher';
import {
  normalizePublicIdentifierInput,
  providerIdentifierFollowsSession,
  providerRequiresSecret,
  providerTakesAppKey,
  validateAppKey,
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
    // ID que segue a sessão (Shein) não é digitado: a conexão só nasce pela extensão.
    if (providerIdentifierFollowsSession(input.provider)) {
      throw new AffiliateCredentialInvalidError('Provider is connected through the browser extension', 'provider');
    }
    const publicIdentifier = validatePublicIdentifier(
      input.provider,
      normalizePublicIdentifierInput(input.provider, input.publicIdentifier),
    );
    if (!publicIdentifier) {
      throw new AffiliateCredentialInvalidError('Invalid public identifier', 'publicIdentifier');
    }

    const rawSecret = this.rawSecret(input);
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

  /**
   * Segredo digitado. AliExpress: App Key e App Secret vêm separados e viram `appKey:appSecret` (formato validado e
   * cifrado como um só); os dois vazios = mantém o atual; só um preenchido = 422 no que falta.
   */
  private rawSecret(input: UpsertAffiliateCredentialInput): string {
    const appSecret = input.secret?.trim() ?? '';
    const rawAppKey = input.appKey?.trim() ?? '';
    if (!providerTakesAppKey(input.provider)) {
      if (rawAppKey) throw new AffiliateCredentialInvalidError('Provider does not take an app key', 'appKey');
      return appSecret;
    }
    if (!rawAppKey && !appSecret) return '';
    if (!rawAppKey) throw new AffiliateCredentialInvalidError('App key is required', 'appKey');
    if (!appSecret) throw new AffiliateCredentialInvalidError('Secret is required', 'secret');
    const appKey = validateAppKey(input.provider, rawAppKey);
    if (!appKey) throw new AffiliateCredentialInvalidError('Invalid app key', 'appKey');
    return `${appKey}:${appSecret}`;
  }
}
