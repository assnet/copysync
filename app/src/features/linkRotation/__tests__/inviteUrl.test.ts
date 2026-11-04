import { describe, expect, it } from 'vitest';
import { isValidInviteUrl } from '../inviteUrl';

const CODE = 'AbCdEfGhIjKlMnOpQrStUv';

describe('isValidInviteUrl', () => {
  it.each([`https://chat.whatsapp.com/${CODE}`, `chat.whatsapp.com/invite/${CODE}/`])('WhatsApp aceita %s', (u) =>
    expect(isValidInviteUrl(u, 'whatsapp')).toBe(true));
  it.each(['https://chat.whatsapp.com/curto', 'https://t.me/+AbCdEf_12-GhIjKl', ''])('WhatsApp recusa %s', (u) =>
    expect(isValidInviteUrl(u, 'whatsapp')).toBe(false));
  it.each([
    'https://t.me/+AbCdEf_12-GhIjKl', 't.me/joinchat/AbCdEf_12-GhIjKl', 'https://telegram.me/canal_ofertas', 'www.t.me/OfertasBR/',
  ])('Telegram aceita %s', (u) => expect(isValidInviteUrl(u, 'telegram')).toBe(true));
  it.each([
    `https://chat.whatsapp.com/${CODE}`, 'https://t.me/abc', 'https://t.me/canal/12', 'https://t.me/share', 'https://t.me.evil.com/+AbCdEf_12-GhIjKl',
  ])('Telegram recusa %s', (u) => expect(isValidInviteUrl(u, 'telegram')).toBe(false));
});
