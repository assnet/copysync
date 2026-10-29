import { describe, expect, it } from 'vitest';
import { inviteUrlFromCode, parseInviteCode } from './inviteUrl';

const CODE = 'AbCdEfGhIjKlMnOpQrStUv';

describe('parseInviteCode', () => {
  it.each([
    `https://chat.whatsapp.com/${CODE}`,
    `http://chat.whatsapp.com/${CODE}`,
    `chat.whatsapp.com/${CODE}`,
    `https://www.chat.whatsapp.com/${CODE}/`,
    `https://chat.whatsapp.com/invite/${CODE}`,
    `  https://chat.whatsapp.com/${CODE}?mode=r_c#x  `,
  ])('aceita %s', (url) => expect(parseInviteCode(url)).toBe(CODE));

  it.each([
    CODE,
    `https://wa.me/${CODE}`,
    'https://chat.whatsapp.com/curto',
    `https://chat.whatsapp.com/${CODE}-x`,
    `https://evil.com/chat.whatsapp.com/${CODE}`,
    `https://chat.whatsapp.com.evil.com/${CODE}`,
    '',
  ])('recusa %s', (url) => expect(parseInviteCode(url)).toBeNull());

  it('monta a URL pelo code', () => expect(inviteUrlFromCode(CODE)).toBe(`https://chat.whatsapp.com/${CODE}`));
});
