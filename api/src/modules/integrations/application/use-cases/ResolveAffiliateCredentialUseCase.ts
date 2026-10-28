import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { AffiliateProvider } from '../../domain/enums/AffiliateProvider';
import type { ISecretCipher } from '../../../../shared/security/ISecretCipher';
import type { AffiliateSessionSecret, ResolvedAffiliateCredential } from '../dtos/AffiliateCredentialDTO';
import { affiliateCipherAad } from './affiliateCipherAad';
import { providerRequiresSecret, providerUsesSession } from '../../domain/services/affiliateProviderFields';
import { SecretCipherFailedError } from '../../../../shared/errors/internal/SecretCipherErrors';

export type AffiliateCredentialState =
  | { state: 'ok'; cred: ResolvedAffiliateCredential }
  | { state: 'missing' }
  | { state: 'rejected'; since: Date; code: string | null };

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

  /**
   * Estado para quem usa a credencial sem o usuário na frente (monitoramento): `rejected` enquanto a
   * loja tiver recusado (vale para ACTIVE, INACTIVE e linha só-sessão); senão o mesmo de `execute`.
   */
  async resolveState(tenantId: string, provider: AffiliateProvider): Promise<AffiliateCredentialState> {
    const record = await this.repo.findByTenantAndProvider(tenantId, provider);
    if (record?.rejectedAt) return { state: 'rejected', since: record.rejectedAt, code: record.rejectedCode };
    const cred = await this.execute(tenantId, provider);
    return cred ? { state: 'ok', cred } : { state: 'missing' };
  }

  async execute(tenantId: string, provider: AffiliateProvider): Promise<ResolvedAffiliateCredential | null> {
    const record = await this.repo.findActiveByTenantAndProvider(tenantId, provider);
    if (!record?.publicIdentifier) return null;
    if (providerRequiresSecret(provider) && !record.secret) return null;

    const secret = record.secret
      ? this.cipher().decrypt(record.secret, affiliateCipherAad(tenantId, provider, 'secret'))
      : null;
    // Sessão só é decifrada para provider que a usa (ML); as demais nem saem do banco em claro
    const session =
      record.session && providerUsesSession(provider)
        ? this.parseSession(this.cipher().decrypt(record.session, affiliateCipherAad(tenantId, provider, 'session')))
        : null;

    return { provider, publicIdentifier: record.publicIdentifier, secret, session };
  }

  private parseSession(plain: string): AffiliateSessionSecret {
    try {
      const raw = JSON.parse(plain) as Record<string, unknown>;
      if (raw.cookies && typeof raw.cookies === 'object') {
        return raw as unknown as AffiliateSessionSecret;
      }
      if (typeof raw.sessionToken === 'string') {
        return {
          cookies: { ssid: raw.sessionToken as string },
          csrf: typeof raw.csrfToken === 'string' ? (raw.csrfToken as string) : undefined,
        };
      }
      throw new Error('unrecognized format');
    } catch {
      throw new SecretCipherFailedError();
    }
  }
}
