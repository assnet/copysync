import { describe, expect, it } from 'vitest';
import { getUnmetRequirements, validatePasswordPolicy } from './passwordPolicy';
import { WeakPasswordError } from '../errors/internal/AuthErrors';

describe('getUnmetRequirements', () => {
  it('não aponta falha para senha que cumpre a política inteira', () => {
    expect(getUnmetRequirements('Senha@123')).toEqual([]);
  });

  it('lista todas as falhas de uma vez, não só a primeira', () => {
    expect(getUnmetRequirements('abc')).toEqual([
      'Mínimo 8 caracteres',
      'Pelo menos 1 letra maiúscula',
      'Pelo menos 1 número',
      'Pelo menos 1 caractere especial (!@#$%^&*()_+-=[]{}|;:\'",.<>?/`~)',
    ]);
  });

  it('aceita senha longa sem caractere especial como incompleta', () => {
    expect(getUnmetRequirements('SenhaLonga123')).toEqual([
      'Pelo menos 1 caractere especial (!@#$%^&*()_+-=[]{}|;:\'",.<>?/`~)',
    ]);
  });
});

describe('validatePasswordPolicy', () => {
  it('passa silenciosamente quando a senha cumpre a política', () => {
    expect(() => validatePasswordPolicy('Senha@123')).not.toThrow();
  });

  it('lança WeakPasswordError com os requisitos não cumpridos', () => {
    expect(() => validatePasswordPolicy('abc')).toThrow(WeakPasswordError);
  });
});
