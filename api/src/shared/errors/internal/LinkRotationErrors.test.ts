import { describe, it, expect } from 'vitest';
import { AppError } from '../AppError';
import {
  LinkDomainInUseError,
  LinkDomainInvalidError,
  LinkSlugInvalidError,
  LinkSlugReservedError,
  LinkSlugTakenError,
  LinkRotationNotFoundError,
  LinkGroupInvalidError,
  LinkInviteUrlInvalidError,
} from './LinkRotationErrors';
import { GroupInviteNotAllowedError } from './GroupErrors';

describe('LinkRotationErrors', () => {
  it.each([
    [new LinkDomainInUseError('d1'), 'LINK_DOMAIN_IN_USE', 409],
    [new LinkDomainInvalidError(), 'LINK_DOMAIN_INVALID', 400],
    [new LinkSlugInvalidError(), 'LINK_SLUG_INVALID', 400],
    [new LinkSlugReservedError('www'), 'LINK_SLUG_RESERVED', 409],
    [new LinkSlugTakenError([]), 'LINK_SLUG_TAKEN', 409],
    [new LinkRotationNotFoundError(), 'LINK_ROTATION_NOT_FOUND', 404],
    [new LinkGroupInvalidError(), 'LINK_GROUP_INVALID', 400],
    [new LinkInviteUrlInvalidError(), 'LINK_INVITE_URL_INVALID', 400],
    [new GroupInviteNotAllowedError(), 'GROUP_INVITE_NOT_ALLOWED', 403],
  ])('%s responde com o código e o HTTP do contrato', (error, code, status) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(code);
    expect(error.statusCode).toBe(status);
  });

  it('LINK_SLUG_TAKEN leva as sugestões em meta', () => {
    expect(new LinkSlugTakenError(['promo-2', 'promo-vip']).meta).toEqual({
      suggestions: ['promo-2', 'promo-vip'],
    });
  });
});
