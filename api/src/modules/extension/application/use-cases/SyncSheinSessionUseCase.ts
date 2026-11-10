import type { IExtensionSessionRepository } from '../../domain/contracts/IExtensionSessionRepository';
import type { IExtensionEntitlementReader } from '../../domain/contracts/IExtensionEntitlementReader';
import { SHEIN_SESSION_COOKIES } from '../../domain/constants';
import type { ExtensionProfile } from './GetExtensionProfileUseCase';
import type { IMarketplaceRiskAcceptanceRepository } from '../../../integrations/domain/contracts/IMarketplaceRiskAcceptanceRepository';
import type { AffiliateCredential } from '../../../integrations/domain/entities/AffiliateCredential';
import type {
  AffiliateCredentialKeyInput,
  UpsertAffiliateSessionInput,
} from '../../../integrations/application/dtos/AffiliateCredentialDTO';
import { requireMarketplaceRiskAccepted } from '../../../integrations/application/services/requireMarketplaceRiskAccepted';
import { sheinSessionMemberId } from '../../../integrations/domain/services/sheinSessionMemberId';
import { marketplaceEntitlementKey } from '../../../campaigns/domain/services/marketplaceEntitlement';
import {
  AffiliateCredentialInvalidError,
  AffiliateCredentialNotFoundError,
} from '../../../../shared/errors/internal/AffiliateCredentialErrors';
import { PlanFeatureUnavailableError } from '../../../../shared/errors/internal/PlanErrors';
import {
  ExtensionTenantAccessDeniedError,
  MarketplaceConsentRequiredError,
} from '../../../../shared/errors/internal/ExtensionErrors';

export interface SyncSheinSessionInput {
  /** Snapshot do `extensionAuthHook`. */
  session: { sessionId: string; userId: string; mlTenantId: string; sheinConsent: boolean };
  cookies: { AT: string; memberId: string };
  capturedAt: string;
}

export interface SyncSheinSessionResult {
  affiliateId: string;
}

export interface SyncSheinSessionDeps {
  riskAcceptances: IMarketplaceRiskAcceptanceRepository;
  entitlements: Pick<IExtensionEntitlementReader, 'hasMarketplace'>;
  profile: { execute(userId: string, mlTenantId: string): Promise<ExtensionProfile> };
  upsertSession: { execute(input: UpsertAffiliateSessionInput): Promise<AffiliateCredential> };
  sessions: Pick<IExtensionSessionRepository, 'hasConsent' | 'hasAnyConsentForTenant'>;
  deleteCredential: { execute(input: AffiliateCredentialKeyInput): Promise<void> };
}

/**
 * Grava a sessão Shein enviada pela extensão. Ordem fixa (design §Apresentação):
 * consentimento → aceite do aviso vigente → plano → vínculo → identidade do token → upsert →
 * releitura do consentimento (corrida com "Desconectar"). O corpo nunca define o ID: vem do `m` do token.
 * Token nunca sai daqui (nem em erro, log ou auditoria).
 */
export class SyncSheinSessionUseCase {
  constructor(private readonly deps: SyncSheinSessionDeps) {}

  async execute(input: SyncSheinSessionInput): Promise<SyncSheinSessionResult> {
    const { sessionId, userId, mlTenantId: tenantId } = input.session;

    // 1. Consentimento da instalação para a Shein
    if (!input.session.sheinConsent) throw new MarketplaceConsentRequiredError('SHEIN');
    // 1b. Aceite da versão vigente do aviso de risco
    await requireMarketplaceRiskAccepted(this.deps.riskAcceptances, tenantId, 'SHEIN');
    // 2. Plano
    if (!(await this.deps.entitlements.hasMarketplace(tenantId, 'SHEIN'))) {
      throw new PlanFeatureUnavailableError(marketplaceEntitlementKey('SHEIN') ?? 'SHEIN');
    }
    // 3. Vínculo: o perfil já descarta tenant inativo
    const profile = await this.deps.profile.execute(userId, tenantId);
    if (!profile.tenants.some((t) => t.id === tenantId)) throw new ExtensionTenantAccessDeniedError();

    // 4. Identidade: `m` do token tem de ser o `memberId` do cookie
    const memberId = sheinSessionMemberId(input.cookies.AT);
    if (memberId === null || memberId !== input.cookies.memberId.trim()) {
      throw new AffiliateCredentialInvalidError('Session token does not match the account', 'cookies');
    }

    // 5. Upsert — só os cookies conhecidos
    const cookies: Record<string, string> = {};
    for (const name of SHEIN_SESSION_COOKIES) cookies[name] = name === 'memberId' ? memberId : input.cookies[name];
    const credential = await this.deps.upsertSession.execute({
      tenantId,
      userId,
      provider: 'SHEIN',
      cookies,
      capturedAt: input.capturedAt,
      sessionIdentifier: memberId,
    });

    // 6. "Desconectar" no meio: o consentimento desta sessão sumiu. Só desfaz a gravação se
    // nenhuma outra instalação do tenant ainda consente (a credencial é do tenant, não da sessão).
    if (!(await this.deps.sessions.hasConsent(sessionId, 'SHEIN'))) {
      if (await this.deps.sessions.hasAnyConsentForTenant(tenantId, 'SHEIN')) {
        throw new MarketplaceConsentRequiredError('SHEIN');
      }
      try {
        await this.deps.deleteCredential.execute({ tenantId, userId, provider: 'SHEIN' });
      } catch (err) {
        if (!(err instanceof AffiliateCredentialNotFoundError)) throw err;
      }
      throw new MarketplaceConsentRequiredError('SHEIN');
    }

    return { affiliateId: credential.publicIdentifier ?? memberId };
  }
}
