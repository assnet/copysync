import { describe, expect, it } from 'vitest';
import { linkRotationStrings } from '../strings';
import { ROTATION_STRATEGIES } from '../types';
import { PRIVACY_SCREENS } from '@/features/privacy';

function leaves(obj: unknown, path = ''): [string, unknown][] {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  }
  if (Array.isArray(obj)) return obj.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  return [[path, obj]];
}

describe('linkRotationStrings', () => {
  it('nenhum texto vazio', () => {
    for (const [path, v] of leaves(linkRotationStrings)) {
      if (typeof v === 'function') continue;
      expect(typeof v, path).toBe('string');
      expect((v as string).trim(), path).not.toBe('');
    }
  });

  it('toda estratégia tem rótulo e descrição', () => {
    for (const s of ROTATION_STRATEGIES) {
      expect(linkRotationStrings.strategy.label[s]).toBeTruthy();
      expect(linkRotationStrings.strategy.description[s]).toBeTruthy();
    }
  });

  it('plural nos contadores', () => {
    expect(linkRotationStrings.card.groups(1, null)).toBe('1 grupo');
    expect(linkRotationStrings.card.groups(2, 3)).toBe('2 de 3 grupos');
  });

  it('flags de privacidade da tela registradas', () => {
    const ids = PRIVACY_SCREENS.find((s) => s.id === 'linkRotation')?.flags.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['linkRotation.rotationLink', 'linkRotation.groupName', 'linkRotation.groupAvatar', 'linkRotation.inviteLink']));
  });
});
