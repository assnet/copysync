import { AppError } from '../AppError';

/** Limite do plano (entitlement) atingido. `key` é a chave do entitlement, ex. `offer_generations_per_day`. */
export class PlanLimitReachedError extends AppError {
  constructor(key: string, limit: number) {
    super('PLAN_LIMIT_REACHED', `Plan limit reached: ${key}`, 403, { key, limit });
  }
}

/** Feature não disponível no plano atual. `key` é a chave do entitlement. */
export class PlanFeatureUnavailableError extends AppError {
  constructor(key: string) {
    super('PLAN_FEATURE_UNAVAILABLE', `Feature not available on current plan: ${key}`, 403, { key });
  }
}
