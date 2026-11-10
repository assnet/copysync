import type { IExtensionSessionRepository } from '../../domain/contracts/IExtensionSessionRepository';
import type { IExtensionEntitlementReader } from '../../domain/contracts/IExtensionEntitlementReader';
import type { ExtensionConsentMarketplace } from '../../domain/constants';
import type { IMarketplaceRiskAcceptanceRepository } from '../../../integrations/domain/contracts/IMarketplaceRiskAcceptanceRepository';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { AffiliateCredentialKeyInput } from '../../../integrations/application/dtos/AffiliateCredentialDTO';
import { requireMarketplaceRiskAccepted } from '../../../integrations/application/services/requireMarketplaceRiskAccepted';
import { marketplaceEntitlementKey } from '../../../campaigns/domain/services/marketplaceEntitlement';
import { AffiliateCredentialNotFoundError } from '../../../../shared/errors/internal/AffiliateCredentialErrors';
import { PlanFeatureUnavailableError } from '../../../../shared/errors/internal/PlanErrors';
import { ExtensionSessionNotFoundError } from '../../../../shared/errors/internal/ExtensionErrors';

/** Marketplace com consentimento próprio na extensão e o provider de credencial correspondente. */
export interface ConsentTarget {
  marketplace: ExtensionConsentMarketplace;
  provider: AffiliateProvider;
}

export interface GrantMarketplaceConsentInput {
  userId: string;
  tenantId: string;
  installationId: string;
}

/**
 * Painel autoriza a instalação a sincronizar o marketplace. Antes de gravar: plano do marketplace e
 * aceite da versão vigente do aviso de risco (provider sem chave/aviso passa).
 */
export class GrantMarketplaceConsentUseCase {
  constructor(
    private readonly target: ConsentTarget,
    private readonly sessions: Pick<IExtensionSessionRepository, 'grantConsent'>,
    private readonly entitlements: Pick<IExtensionEntitlementReader, 'hasMarketplace'>,
    private readonly riskAcceptances: IMarketplaceRiskAcceptanceRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: GrantMarketplaceConsentInput): Promise<void> {
    const { provider, marketplace } = this.target;
    if (!(await this.entitlements.hasMarketplace(input.tenantId, provider))) {
      throw new PlanFeatureUnavailableError(marketplaceEntitlementKey(provider) ?? provider);
    }
    await requireMarketplaceRiskAccepted(this.riskAcceptances, input.tenantId, provider);
    const granted = await this.sessions.grantConsent(marketplace, input.userId, input.installationId, input.tenantId, this.now());
    if (!granted) throw new ExtensionSessionNotFoundError();
  }
}

/**
 * Desconectar no painel: revoga o consentimento de todas as instalações do tenant e depois apaga a
 * credencial inteira (sessão e ID). Ordem importa: ao contrário, a extensão recriaria entre as duas
 * escritas. Idempotente: sem credencial (consentiu e nunca sincronizou) não é erro.
 */
export class DisconnectMarketplaceSessionUseCase {
  constructor(
    private readonly target: ConsentTarget,
    private readonly sessions: Pick<IExtensionSessionRepository, 'revokeConsentForTenant'>,
    private readonly deleteCredential: { execute(input: AffiliateCredentialKeyInput): Promise<void> },
  ) {}

  async execute(input: { tenantId: string; userId: string }): Promise<void> {
    await this.sessions.revokeConsentForTenant(this.target.marketplace, input.tenantId);
    try {
      await this.deleteCredential.execute({ ...input, provider: this.target.provider });
    } catch (err) {
      if (!(err instanceof AffiliateCredentialNotFoundError)) throw err;
    }
  }
}
