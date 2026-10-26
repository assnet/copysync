import { AppError } from '../AppError';

// ── AI provider errors ───────────────────────────────────────────────────────
// Nenhum erro carrega chave, prompt ou corpo de resposta do provedor.

/** Update que desligaria a IA da plataforma e as chaves dos tenants ao mesmo tempo. */
export class AiModesBothDisabledError extends AppError {
  constructor() {
    super('AI_MODES_BOTH_DISABLED', 'At least one AI mode must stay enabled', 422);
  }
}

/** Nem IA da plataforma disponível nem chave própria ativa para o tenant. */
export class AiNotConfiguredError extends AppError {
  constructor() {
    super('AI_NOT_CONFIGURED', 'No AI provider is available for this tenant', 409);
  }
}

export class AiDailyLimitReachedError extends AppError {
  constructor(limit: number) {
    super('AI_DAILY_LIMIT_REACHED', 'Daily AI limit reached', 429, { limit });
  }
}

/** Chave inválida, sem permissão ou pedido recusado pelo provedor (modelo inexistente etc.). */
export class AiProviderRejectedError extends AppError {
  constructor(status?: number) {
    super('AI_PROVIDER_REJECTED', 'AI provider rejected the request', 422, status ? { status } : undefined);
  }
}

export class AiProviderRateLimitedError extends AppError {
  constructor() {
    super('AI_PROVIDER_RATE_LIMITED', 'AI provider rate limit reached', 429);
  }
}

/** 5xx, timeout, falha de rede ou resposta sem texto. */
export class AiProviderUnavailableError extends AppError {
  constructor(reason?: string) {
    super('AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable', 503, reason ? { reason } : undefined);
  }
}

export class AiPlatformProviderNotFoundError extends AppError {
  constructor(id: string) {
    super('AI_PLATFORM_PROVIDER_NOT_FOUND', `AI platform provider not found: ${id}`, 404);
  }
}

export class AiCredentialNotFoundError extends AppError {
  constructor() {
    super('AI_CREDENTIAL_NOT_FOUND', 'AI credential not found', 404);
  }
}

/** `field` aponta o campo do formulário. Nunca carrega o valor. */
export class AiCredentialInvalidError extends AppError {
  constructor(reason: string, field?: string) {
    super('AI_CREDENTIAL_INVALID', reason, 422, field ? { field } : undefined);
  }
}

/** Códigos que o `POST .../test` devolve como `errorCode` em vez de lançar. */
export const AI_PROVIDER_ERROR_CODES = [
  'AI_PROVIDER_REJECTED',
  'AI_PROVIDER_RATE_LIMITED',
  'AI_PROVIDER_UNAVAILABLE',
] as const;
