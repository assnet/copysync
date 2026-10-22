import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { AffiliateCredential } from '../../domain/entities/AffiliateCredential';
import type { EncryptedBlob } from '../../domain/contracts/AffiliateCredentialRecords';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { ISecretCipher } from '../../../../shared/security/ISecretCipher';
import { validatePublicIdentifier } from '../../domain/services/affiliateProviderFields';
import { AffiliateCredentialInvalidError } from '../../../../shared/errors/internal/AffiliateCredentialErrors';
import { logger } from '../../../../shared/logger/logger';
import type { AffiliateSessionSecret, UpsertAffiliateSessionInput } from '../dtos/AffiliateCredentialDTO';
import { affiliateCipherAad } from './affiliateCipherAad';

/** Só o Mercado Livre depende de sessão logada para gerar link. */
const SESSION_PROVIDERS = new Set(['MERCADO_LIVRE']);

/**
 * Grava a sessão do marketplace capturada pela extensão (renovada a cada ~30 min).
 *
 * - Tag inválida é descartada, nunca recusa a sessão (a renovação não pode travar).
 * - Tag só preenche ID vazio: o valor do painel sempre vence.
 * - Audita só quando o token muda; blob atual indecifrável conta como mudança (regrava, sem 500).
 */
export class UpsertAffiliateSessionUseCase {
  constructor(
    private readonly repo: IAffiliateCredentialRepository,
    private readonly cipher: () => ISecretCipher,
    private readonly auditRepo: IAuditLogRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: UpsertAffiliateSessionInput): Promise<AffiliateCredential> {
    if (!SESSION_PROVIDERS.has(input.provider)) {
      throw new AffiliateCredentialInvalidError('Provider does not take a session', 'provider');
    }

    const cipher = this.cipher();
    const aad = affiliateCipherAad(input.tenantId, input.provider, 'session');
    const tag = input.affiliateTag?.trim()
      ? validatePublicIdentifier(input.provider, input.affiliateTag)
      : null;
    const tagIgnored = Boolean(input.affiliateTag?.trim()) && tag === null;

    const existing = await this.repo.findByTenantAndProvider(input.tenantId, input.provider);
    const changed = this.tokenChanged(existing?.session ?? null, aad, input.sessionToken, cipher);

    const payload: AffiliateSessionSecret = { sessionToken: input.sessionToken, csrfToken: input.csrfToken };
    const credential = await this.repo.upsertSession({
      tenantId: input.tenantId,
      provider: input.provider,
      session: cipher.encrypt(JSON.stringify(payload), aad),
      ...(tag && { publicIdentifierIfEmpty: tag }),
      syncedAt: this.now(),
    });

    if (changed) {
      await this.auditRepo.create({
        tenantId: input.tenantId,
        userId: input.userId,
        action: 'AFFILIATE_SESSION_SYNCED',
        meta: { provider: input.provider, capturedAt: input.capturedAt, tagIgnored },
      });
    }

    return credential;
  }

  private tokenChanged(
    current: EncryptedBlob | null,
    aad: string,
    sessionToken: string,
    cipher: ISecretCipher,
  ): boolean {
    if (!current) return true;
    try {
      const stored = JSON.parse(cipher.decrypt(current, aad)) as Partial<AffiliateSessionSecret>;
      return stored.sessionToken !== sessionToken;
    } catch {
      logger.warn('Stored affiliate session could not be decrypted — overwriting');
      return true;
    }
  }
}
