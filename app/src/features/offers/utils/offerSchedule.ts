import { serverNow } from '@/services/serverClock';

/** Espelha `OFFER_SCHEDULE_MAX_DAYS` da API (campaigns/domain/offerSchedule.ts). */
export const SCHEDULE_MAX_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Folga mínima: o horário ainda precisa estar no futuro quando o pedido chegar. */
const MIN_AHEAD_MS = 60_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Date → valor de `<input type="datetime-local">` (hora local, sem segundos). */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Valor do input (hora local) → ISO; vazio ou inválido = null. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Limites do input: daqui a 1 min até o teto de dias (relógio do servidor). */
export function scheduleBounds(now = serverNow()): { min: string; max: string } {
  return { min: toLocalInput(new Date(now + MIN_AHEAD_MS)), max: toLocalInput(new Date(now + SCHEDULE_MAX_DAYS * DAY_MS)) };
}

/** Sugestão ao ligar o agendamento: próxima hora cheia com pelo menos 30 min de folga. */
export function defaultScheduleInput(now = serverNow()): string {
  const date = new Date(now + 30 * 60_000);
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return toLocalInput(date);
}

export type ScheduleProblem = 'required' | 'past' | 'too_far';

/** Mesma regra da API (futuro, até o teto); a API confere de novo. */
export function scheduleProblem(value: string, now = serverNow()): ScheduleProblem | null {
  const iso = fromLocalInput(value);
  if (!iso) return 'required';
  const at = Date.parse(iso);
  if (at <= now) return 'past';
  if (at - now > SCHEDULE_MAX_DAYS * DAY_MS) return 'too_far';
  return null;
}

/** Início ainda no futuro (oferta agendada esperando o horário). */
export function isPendingSchedule(scheduledAt: string | null, now = serverNow()): boolean {
  return scheduledAt != null && Date.parse(scheduledAt) > now;
}
