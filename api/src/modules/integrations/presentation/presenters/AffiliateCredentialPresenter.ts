import type { AffiliateCredential } from '../../domain/entities/AffiliateCredential';
import { maskIdentifier } from '../../domain/services/maskIdentifier';
import type { AffiliateCredentialListResult } from '../../application/use-cases/ListAffiliateCredentialsUseCase';
import type { AffiliateIdentifiersResult } from '../../application/use-cases/GetAffiliateIdentifiersUseCase';

/**
 * Saída HTTP de credencial: só flags e ID público. `publicIdentifier` em claro existe para o
 * diálogo de edição pré-preencher (não é segredo — vai na URL do link); o card usa o mascarado.
 */
export class AffiliateCredentialPresenter {
  /**
   * `identifierLimit`: limite efetivo de etiquetas (só a listagem conhece; null = provider sem lista da
   * conta ou resposta de escrita). As etiquetas saem em claro como `publicIdentifier` (o painel borra).
   */
  static toItem(c: AffiliateCredential, identifierLimit: number | null = null) {
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
      accountIdentifiers: c.accountIdentifiers ?? [],
      linkedIdentifiers: c.linkedIdentifiers ?? [],
      identifierLimit,
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
    const items = result.items.map((c) => AffiliateCredentialPresenter.toItem(c, result.identifierLimits[c.provider] ?? null));
    return { items, marketplaceAvailability };
  }

  static toIdentifiers(r: AffiliateIdentifiersResult) {
    return { account: r.account, primary: r.primary, linked: r.linked, limit: r.limit, used: r.used };
  }

  /** Sync da sessão Shein pela extensão: só o ID da conta, nunca o token. */
  static toSheinSessionSync(result: { affiliateId: string }) {
    return { affiliateId: result.affiliateId };
  }

  static toSessionSync(c: AffiliateCredential) {
    return { provider: c.provider, status: c.status, updatedAt: c.updatedAt.toISOString() };
  }
}
