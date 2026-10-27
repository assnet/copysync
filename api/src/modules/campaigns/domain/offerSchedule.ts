/**
 * Agendamento do início dos disparos. Teto de 30 dias: oferta de afiliado envelhece (preço,
 * estoque, cupom) e a fila no banco não deve guardar envio para muito longe.
 */
export const OFFER_SCHEDULE_MAX_DAYS = 30;
const MAX_AHEAD_MS = OFFER_SCHEDULE_MAX_DAYS * 24 * 60 * 60 * 1000;

export type OfferScheduleProblem = 'past' | 'too_far';

/** Horário escolhido pelo operador: precisa estar no futuro e dentro do teto. */
export function offerScheduleProblem(at: Date, now: Date): OfferScheduleProblem | null {
  if (at.getTime() <= now.getTime()) return 'past';
  if (at.getTime() - now.getTime() > MAX_AHEAD_MS) return 'too_far';
  return null;
}

/** Horário do primeiro envio: o agendado, ou agora se não há agendamento ou ele já passou. */
export function dispatchStartAt(scheduledAt: Date | null, now: Date): Date {
  return scheduledAt && scheduledAt.getTime() > now.getTime() ? scheduledAt : now;
}
