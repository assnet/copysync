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
