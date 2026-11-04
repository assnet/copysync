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

/** Mesmo código gravado pelo monitor quando a loja recusa (`BuildTenantAffiliateLinkUseCase`). */
const SESSION_REJECTED_CODE = 'AFFILIATE_CREDENTIAL_REJECTED';

/**
 * Grava a sessão do marketplace capturada pela extensão (renovada a cada ~30 min).
 *
 * - Tag inválida é descartada, nunca recusa a sessão (a renovação não pode travar).
 * - Tag só preenche ID vazio: o valor do painel sempre vence.
 * - Audita só quando o token muda; blob atual indecifrável conta como mudança (regrava, sem 500).
 * - Rejeição: checagem da loja no sync decide (VALID libera, REJECTED recusa). Sem checagem,
 *   só token novo libera — o navegador pode seguir logado com o mesmo token que a loja recusou
 *   no servidor, então "mesmo token" sozinho nunca prova nada.
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
    const changed = this.tokenChanged(existing?.session ?? null, aad, input.cookies.ssid ?? '', cipher);

    const payload: AffiliateSessionSecret = { cookies: input.cookies, csrf: input.csrf };
    const now = this.now();
    // Recusa já gravada mantém a data original ("recusada desde")
    const newlyRejected = input.sessionCheck === 'REJECTED' && !existing?.rejectedAt;
    const credential = await this.repo.upsertSession({
      tenantId: input.tenantId,
      provider: input.provider,
      session: cipher.encrypt(JSON.stringify(payload), aad),
      ...(tag && { publicIdentifierIfEmpty: tag }),
      syncedAt: now,
      clearRejection: input.sessionCheck === 'VALID' || (input.sessionCheck === undefined && changed),
      ...(newlyRejected && { rejectWith: { at: now, code: SESSION_REJECTED_CODE } }),
    });

    if (newlyRejected) {
      await this.auditRepo.create({
        tenantId: input.tenantId,
        userId: input.userId,
        action: 'AFFILIATE_CREDENTIAL_REJECTED',
        meta: { provider: input.provider, code: SESSION_REJECTED_CODE, source: 'session-sync' },
      });
    }

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
    newSsid: string,
    cipher: ISecretCipher,
  ): boolean {
    if (!current) return true;
    try {
      const raw = JSON.parse(cipher.decrypt(current, aad)) as Record<string, unknown>;
      const storedSsid = raw.cookies && typeof raw.cookies === 'object'
        ? (raw.cookies as Record<string, string>).ssid
        : (raw as Record<string, string>).sessionToken;
      return storedSsid !== newSsid;
    } catch {
      logger.warn('Stored affiliate session could not be decrypted — overwriting');
      return true;
    }
  }
}
