import { describe, expect, it } from 'vitest';
import { evaluatePasswordConfirmationLock } from './passwordConfirmationRules';

const T0 = new Date('2026-11-13T12:00:00.000Z').getTime();
const at = (min: number) => new Date(T0 + min * 60_000);

describe('evaluatePasswordConfirmationLock', () => {
  it('até 4 falhas na janela não bloqueia', () => {
    expect(evaluatePasswordConfirmationLock([at(0), at(1), at(2), at(3)], at(4))).toEqual({ locked: false });
  });

  it('5 falhas em 15 min bloqueiam por 15 min a partir da 5ª', () => {
    const failures = [at(0), at(1), at(2), at(3), at(4)];
    expect(evaluatePasswordConfirmationLock(failures, at(4))).toEqual({ locked: true, retryAfterSeconds: 900 });
    // a 1ª falha já saiu da janela de 15 min, mas o bloqueio vale até a 5ª + 15 min
    expect(evaluatePasswordConfirmationLock(failures, at(18))).toEqual({ locked: true, retryAfterSeconds: 60 });
    expect(evaluatePasswordConfirmationLock(failures, at(19))).toEqual({ locked: false });
  });

  it('5 falhas espalhadas além de 15 min não bloqueiam', () => {
    expect(evaluatePasswordConfirmationLock([at(0), at(5), at(10), at(15), at(20)], at(20))).toEqual({ locked: false });
  });

  it('depois do bloqueio o usuário tem 5 tentativas novas', () => {
    const old = [at(0), at(1), at(2), at(3), at(4)];
    const fresh = [at(20), at(21), at(22), at(23)];
    expect(evaluatePasswordConfirmationLock([...old, ...fresh], at(23))).toEqual({ locked: false });
    expect(evaluatePasswordConfirmationLock([...old, ...fresh, at(24)], at(24))).toMatchObject({ locked: true });
  });

  it('ordem de entrada não importa', () => {
    expect(evaluatePasswordConfirmationLock([at(4), at(0), at(3), at(1), at(2)], at(5))).toMatchObject({ locked: true });
  });
});
