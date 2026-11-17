import { describe, it, expect } from 'vitest';
import { canSaver, saverPermissionSet, SAVER_ACTIONS, type SaverRole } from './saverPermissions';

const SEM = { export: false };
const COM = { export: true };

describe('canSaver', () => {
  it.each<SaverRole>(['ADMIN', 'SUPER_ADMIN'])('%s pode tudo e ignora a liberação', (role) => {
    for (const action of SAVER_ACTIONS) {
      expect(canSaver(role, action, SEM)).toBe(true);
      expect(canSaver(role, action, COM)).toBe(true);
    }
  });

  it('OPERATOR sem liberação vê e extrai, mas não exporta nem configura', () => {
    expect(canSaver('OPERATOR', 'view', SEM)).toBe(true);
    expect(canSaver('OPERATOR', 'extract', SEM)).toBe(true);
    expect(canSaver('OPERATOR', 'export', SEM)).toBe(false);
    expect(canSaver('OPERATOR', 'configure', SEM)).toBe(false);
  });

  it('OPERATOR liberado exporta e continua sem configurar', () => {
    expect(canSaver('OPERATOR', 'export', COM)).toBe(true);
    expect(canSaver('OPERATOR', 'configure', COM)).toBe(false);
  });

  it('sem liberação informada vale "não liberado"', () => {
    expect(canSaver('OPERATOR', 'export')).toBe(false);
  });

  it('papel desconhecido não pode nada', () => {
    expect(canSaver('VIEWER' as SaverRole, 'view', COM)).toBe(false);
  });
});

describe('saverPermissionSet', () => {
  it('monta as permissões efetivas para o resumo', () => {
    expect(saverPermissionSet('OPERATOR', COM)).toEqual({ view: true, extract: true, export: true, configure: false });
    expect(saverPermissionSet('ADMIN')).toEqual({ view: true, extract: true, export: true, configure: true });
  });
});
