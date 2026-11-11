import { AppError } from '../AppError';

// ── Affiliate credential errors ──────────────────────────────────────────────

export class AffiliateCredentialNotFoundError extends AppError {
  constructor(provider: string) {
    super('AFFILIATE_CREDENTIAL_NOT_FOUND', `Affiliate credential not found: ${provider}`, 404);
  }
}

/** `field` diz qual campo falhou, para o painel apontar no formulário. Nunca carrega o valor. */
export class AffiliateCredentialInvalidError extends AppError {
  constructor(reason: string, field?: string) {
    super('AFFILIATE_CREDENTIAL_INVALID', reason, 422, field ? { field } : undefined);
  }
}

/**
 * Provider cujo ID segue a sessão (Shein) só desconecta pela rota do marketplace, que revoga o
 * consentimento antes de apagar: senão o próximo sync da extensão recriaria a credencial.
 */
export class UseMarketplaceDisconnectError extends AppError {
  constructor(provider: string) {
    super('USE_MARKETPLACE_DISCONNECT', `Disconnect this marketplace through its own route: ${provider}`, 409, { provider });
  }
}

/**
 * Link com etiqueta da própria conta que ainda não está vinculada, e o plano tem vaga (`used < limit`).
 * Nunca carrega a etiqueta (nem no `meta`).
 */
export class AffiliateIdentifierNotLinkedError extends AppError {
  constructor(provider: string, limit: number, used: number) {
    super('AFFILIATE_IDENTIFIER_NOT_LINKED', `Affiliate identifier not linked: ${provider}`, 422, { provider, limit, used });
  }
}
