import { describe, expect, it } from 'vitest';
import { defaultScheduleInput, fromLocalInput, isPendingSchedule, scheduleProblem, toLocalInput } from './offerSchedule';

const NOW = new Date(2026, 9, 27, 14, 40).getTime();
const DAY = 24 * 60 * 60 * 1000;

describe('offerSchedule', () => {
  it('ida e volta do input datetime-local em hora local', () => {
    const value = toLocalInput(new Date(2026, 9, 28, 9, 5));
    expect(value).toBe('2026-10-28T09:05');
    expect(fromLocalInput(value)).toBe(new Date(2026, 9, 28, 9, 5).toISOString());
    expect(fromLocalInput('')).toBeNull();
  });

  it('sugestão = próxima hora cheia com folga de 30 min', () => {
    expect(defaultScheduleInput(NOW)).toBe('2026-10-27T16:00');
  });

  it('valida vazio, passado e teto de 30 dias', () => {
    expect(scheduleProblem('', NOW)).toBe('required');
    expect(scheduleProblem(toLocalInput(new Date(NOW - 60_000)), NOW)).toBe('past');
    expect(scheduleProblem(toLocalInput(new Date(NOW + 31 * DAY)), NOW)).toBe('too_far');
    expect(scheduleProblem(toLocalInput(new Date(NOW + DAY)), NOW)).toBeNull();
  });

  it('agendamento pendente só com horário futuro', () => {
    expect(isPendingSchedule(null, NOW)).toBe(false);
    expect(isPendingSchedule(new Date(NOW + 1000).toISOString(), NOW)).toBe(true);
    expect(isPendingSchedule(new Date(NOW - 1000).toISOString(), NOW)).toBe(false);
  });
});
