import { describe, expect, it } from 'vitest';
import { GROUP_CAPACITY, channelForEngine, inviteUrlFromCode, parseInviteCode } from './inviteUrl';

const CODE = 'AbCdEfGhIjKlMnOpQrStUv';
const HASH = 'AbCdEf_12-GhIjKl';

describe('parseInviteCode (WhatsApp)', () => {
  it.each([
    `https://chat.whatsapp.com/${CODE}`,
    `http://chat.whatsapp.com/${CODE}`,
    `chat.whatsapp.com/${CODE}`,
    `https://www.chat.whatsapp.com/${CODE}/`,
    `https://chat.whatsapp.com/invite/${CODE}`,
    `  https://chat.whatsapp.com/${CODE}?mode=r_c#x  `,
  ])('aceita %s', (url) => expect(parseInviteCode(url, 'whatsapp')).toBe(CODE));

  it.each([
    CODE,
    `https://wa.me/${CODE}`,
    'https://chat.whatsapp.com/curto',
    `https://chat.whatsapp.com/${CODE}-x`,
    `https://evil.com/chat.whatsapp.com/${CODE}`,
    `https://chat.whatsapp.com.evil.com/${CODE}`,
    `https://t.me/+${HASH}`,
    '',
  ])('recusa %s', (url) => expect(parseInviteCode(url, 'whatsapp')).toBeNull());

  it('monta a URL pelo code', () => expect(inviteUrlFromCode(CODE, 'whatsapp')).toBe(`https://chat.whatsapp.com/${CODE}`));
});

describe('parseInviteCode (Telegram)', () => {
  it.each([
    [`https://t.me/+${HASH}`, `+${HASH}`],
    [`t.me/+${HASH}`, `+${HASH}`],
    [`http://www.t.me/+${HASH}/`, `+${HASH}`],
    [`https://telegram.me/+${HASH}?x=1#y`, `+${HASH}`],
    [`https://t.me/joinchat/${HASH}`, `+${HASH}`],
    [`telegram.me/joinchat/${HASH}`, `+${HASH}`],
    ['https://t.me/canal_ofertas', 'canal_ofertas'],
    ['  T.ME/OfertasBR  ', 'OfertasBR'],
    ['https://telegram.dog/ofertas_br', 'ofertas_br'],
    ['https://t.me/ofertas?start=abc', 'ofertas'],
  ])('aceita %s', (url, code) => expect(parseInviteCode(url, 'telegram')).toBe(code));

  it.each([
    `+${HASH}`,
    'canal_ofertas',
    `https://chat.whatsapp.com/${CODE}`,
    'https://t.me/+curto',
    'https://t.me/abc',
    'https://t.me/1ofertas',
    'https://t.me/ofertas_',
    'https://t.me/ofertas/123',
    'https://t.me/c/123456/7',
    'https://t.me/addstickers/pack',
    'https://t.me/joinchat',
    'https://t.me/share',
    `https://evil.com/t.me/+${HASH}`,
    `https://t.me.evil.com/+${HASH}`,
    '',
  ])('recusa %s', (url) => expect(parseInviteCode(url, 'telegram')).toBeNull());

  it('monta a URL pelo code', () => {
    expect(inviteUrlFromCode(`+${HASH}`, 'telegram')).toBe(`https://t.me/+${HASH}`);
    expect(inviteUrlFromCode('canal_ofertas', 'telegram')).toBe('https://t.me/canal_ofertas');
  });
});

describe('canal e teto', () => {
  it('canal vem do engine da sessão', () => {
    expect(channelForEngine('telegram')).toBe('telegram');
    expect(channelForEngine('baileys')).toBe('whatsapp');
    expect(channelForEngine(null)).toBe('whatsapp');
  });

  it('faixa de membros por canal', () => {
    expect(GROUP_CAPACITY.whatsapp).toEqual({ min: 50, max: 1024, default: 1000 });
    expect(GROUP_CAPACITY.telegram.max).toBe(200_000);
  });
});
