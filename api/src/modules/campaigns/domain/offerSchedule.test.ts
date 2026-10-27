import { describe, expect, it } from 'vitest';
import { dispatchStartAt, offerScheduleProblem } from './offerSchedule';

const now = new Date('2026-10-27T12:00:00Z');
const plus = (ms: number) => new Date(now.getTime() + ms);
const DAY = 24 * 60 * 60 * 1000;

describe('offerScheduleProblem', () => {
  it('aceita horário futuro dentro do teto', () => {
    expect(offerScheduleProblem(plus(60_000), now)).toBeNull();
    expect(offerScheduleProblem(plus(30 * DAY), now)).toBeNull();
  });

  it('recusa horário passado ou igual a agora', () => {
    expect(offerScheduleProblem(now, now)).toBe('past');
    expect(offerScheduleProblem(plus(-1), now)).toBe('past');
  });

  it('recusa além de 30 dias', () => {
    expect(offerScheduleProblem(plus(30 * DAY + 1), now)).toBe('too_far');
  });
});

describe('dispatchStartAt', () => {
  it('usa o agendado quando ainda está no futuro', () => {
    expect(dispatchStartAt(plus(DAY), now)).toEqual(plus(DAY));
  });

  it('cai para agora sem agendamento ou com horário vencido', () => {
    expect(dispatchStartAt(null, now)).toBe(now);
    expect(dispatchStartAt(plus(-DAY), now)).toBe(now);
  });
});
