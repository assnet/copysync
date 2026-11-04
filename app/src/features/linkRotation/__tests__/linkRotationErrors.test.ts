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

  it('PLAN_LIMIT_REACHED do Telegram abre o aviso do canal', () => {
    expect(linkRotationError({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'telegram_link_rotations', limit: 0 } })).toMatchObject({
      limitKind: 'telegramLinkRotations', limit: 0, message: linkRotationStrings.errors.planLimitTelegramRotations(0),
    });
    expect(linkRotationError({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'telegram_link_rotation_groups', limit: 5 } })).toMatchObject({ limitKind: 'telegramLinkRotationGroups' });
  });

  it('LINK_INVITE_URL_INVALID mostra o formato do canal', () => {
    expect(linkRotationError({ code: 'LINK_INVITE_URL_INVALID', meta: { channel: 'telegram' } }).message).toBe(linkRotationStrings.errors.inviteUrlInvalid.telegram);
    expect(linkRotationError({ code: 'LINK_INVITE_URL_INVALID' }).message).toBe(linkRotationStrings.errors.inviteUrlInvalid.whatsapp);
  });

  it('GROUP_INVITE_NOT_ALLOWED pede sessão admin', () => {
    expect(linkRotationError({ code: 'GROUP_INVITE_NOT_ALLOWED' }).message).toBe('Esta sessão precisa ser admin para gerar convite.');
  });

  it('LINK_SLUG_TAKEN devolve só sugestões em texto', () => {
    expect(linkRotationError({ code: 'LINK_SLUG_TAKEN', meta: { suggestions: ['promo-2', 3, 'promo-3'] } }).suggestions).toEqual(['promo-2', 'promo-3']);
  });
});
