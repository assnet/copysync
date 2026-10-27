import { offerScheduleProblem } from '../../domain/offerSchedule';
import { OfferInvalidInputError } from '../../../../shared/errors/internal/OfferErrors';

/**
 * `scheduledAt` vindo do HTTP (ISO). undefined = não mexe; null = sem agendamento.
 * Horário passado ou além do teto → 422 no campo `scheduledAt`.
 */
export function parseOfferSchedule(value: string | null | undefined, now: Date): Date | null | undefined {
  if (value === undefined || value === null) return value;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw new OfferInvalidInputError('Invalid schedule', 'scheduledAt');
  const problem = offerScheduleProblem(at, now);
  if (problem === 'past') throw new OfferInvalidInputError('Schedule must be in the future', 'scheduledAt');
  if (problem === 'too_far') throw new OfferInvalidInputError('Schedule is too far ahead', 'scheduledAt');
  return at;
}
