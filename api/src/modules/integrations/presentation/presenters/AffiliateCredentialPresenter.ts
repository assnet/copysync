import type { AffiliateCredential } from '../../domain/entities/AffiliateCredential';
import { maskIdentifier } from '../../domain/services/maskIdentifier';
import type { AffiliateCredentialListResult } from '../../application/use-cases/ListAffiliateCredentialsUseCase';

/**
 * Saída HTTP de credencial: só flags e ID público. `publicIdentifier` em claro existe para o
 * diálogo de edição pré-preencher (não é segredo — vai na URL do link); o card usa o mascarado.
 */
export class AffiliateCredentialPresenter {
  static toItem(c: AffiliateCredential) {
    return {
      provider: c.provider,
      status: c.status,
      publicIdentifier: c.publicIdentifier,
      publicIdentifierMasked: c.publicIdentifier ? maskIdentifier(c.publicIdentifier) : null,
      hasSecret: c.hasSecret,
      hasSession: c.hasSession,
      sessionSyncedAt: c.sessionSyncedAt?.toISOString() ?? null,
      lastValidatedAt: c.lastValidatedAt?.toISOString() ?? null,
      rejectedAt: c.rejectedAt?.toISOString() ?? null,
      rejectedCode: c.rejectedCode,
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  static toList(result: AffiliateCredentialListResult) {
    const marketplaceAvailability = Object.fromEntries(
      Object.entries(result.marketplaceAvailability).map(([provider, a]) => [
        provider,
        {
          enabled: a.enabled,
          plans: a.plans,
          riskNotice: a.riskNotice && {
            version: a.riskNotice.version,
            acceptedAt: a.riskNotice.acceptedAt?.toISOString() ?? null,
            acceptedByMe: a.riskNotice.acceptedByMe,
          },
        },
      ]),
    );
    return { items: result.items.map(AffiliateCredentialPresenter.toItem), marketplaceAvailability };
  }

  /** Sync da sessão Shein pela extensão: só o ID da conta, nunca o token. */
  static toSheinSessionSync(result: { affiliateId: string }) {
    return { affiliateId: result.affiliateId };
  }

  static toSessionSync(c: AffiliateCredential) {
    return { provider: c.provider, status: c.status, updatedAt: c.updatedAt.toISOString() };
  }
}
