import type { AffiliateCredential } from '../../domain/entities/AffiliateCredential';
import { maskIdentifier } from '../../domain/services/maskIdentifier';

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
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  static toList(items: AffiliateCredential[]) {
    return { items: items.map(AffiliateCredentialPresenter.toItem) };
  }

  static toSessionSync(c: AffiliateCredential) {
    return { provider: c.provider, status: c.status, updatedAt: c.updatedAt.toISOString() };
  }
}
