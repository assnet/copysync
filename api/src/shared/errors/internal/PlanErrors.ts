import { AppError } from '../AppError';

/** Limite do plano (entitlement) atingido. `key` é a chave do entitlement, ex. `offer_generations_per_day`. */
export class PlanLimitReachedError extends AppError {
  constructor(key: string, limit: number) {
    super('PLAN_LIMIT_REACHED', `Plan limit reached: ${key}`, 403, { key, limit });
  }
}
