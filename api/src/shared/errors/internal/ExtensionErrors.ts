import { AppError } from '../AppError';

// ── Extensão do navegador: consentimento por marketplace (docs/extensao-navegador.md) ──

/** A sessão da extensão não tem consentimento para sincronizar o marketplace. Código `<MARKETPLACE>_CONSENT_REQUIRED`. */
export class MarketplaceConsentRequiredError extends AppError {
  constructor(marketplace: string) {
    super(`${marketplace}_CONSENT_REQUIRED`, `${marketplace} session consent not granted`, 403);
  }
}

/** Não há sessão ativa da extensão para (usuário, instalação, tenant). */
export class ExtensionSessionNotFoundError extends AppError {
  constructor() {
    super('SESSION_NOT_FOUND', 'Extension session not found for this installation', 404);
  }
}

/** O usuário da sessão da extensão não tem mais vínculo com o tenant, ou o tenant não está ativo. */
export class ExtensionTenantAccessDeniedError extends AppError {
  constructor() {
    super('EXTENSION_TENANT_FORBIDDEN', 'Tenant is not available to this extension session', 403);
  }
}
