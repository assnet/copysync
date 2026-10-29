import { describe, expect, it } from 'vitest';
import { LINK_ROTATION_ERROR_CODES, linkRotationError } from '@/utils/linkRotationErrors';
import { linkRotationStrings } from '../strings';

describe('linkRotationError', () => {
  it.each(LINK_ROTATION_ERROR_CODES)('traduz %s sem cair no genérico', (code) => {
    const info = linkRotationError({ code, meta: {} });
    expect(info.code).toBe(code);
    expect(info.message).toBeTruthy();
    expect(info.message).not.toBe(linkRotationStrings.errors.generic);
  });

  it('código desconhecido e mensagem crua viram o genérico', () => {
    expect(linkRotationError({ code: 'X', message: 'stack' }).message).toBe(linkRotationStrings.errors.generic);
    expect(linkRotationError(null).message).toBe(linkRotationStrings.errors.generic);
  });

  it('PLAN_LIMIT_REACHED distingue rodízios de grupos e leva o limite', () => {
    expect(linkRotationError({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'link_rotations', limit: 1 } })).toMatchObject({ limitKind: 'rotations', limit: 1 });
    expect(linkRotationError({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'link_rotation_groups', limit: 5 } })).toMatchObject({ limitKind: 'groups', limit: 5 });
  });

  it('LINK_SLUG_TAKEN devolve só sugestões em texto', () => {
    expect(linkRotationError({ code: 'LINK_SLUG_TAKEN', meta: { suggestions: ['promo-2', 3, 'promo-3'] } }).suggestions).toEqual(['promo-2', 'promo-3']);
  });
});
