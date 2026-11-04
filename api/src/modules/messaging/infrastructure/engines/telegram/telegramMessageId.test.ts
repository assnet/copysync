import { describe, expect, it } from 'vitest';
import { composeTelegramMessageId, parseTelegramMessageId } from './telegramMessageId';

describe('telegramMessageId', () => {
  it('compõe peer + id: mesmo msg.id em chats diferentes não colide', () => {
    expect(composeTelegramMessageId('-1001234567890', 42)).toBe('-1001234567890_42');
    expect(composeTelegramMessageId('-123456', 42)).not.toBe(composeTelegramMessageId('-1001234567890', 42));
  });

  it('extrai peer e id (supergrupo, grupo pequeno, usuário)', () => {
    expect(parseTelegramMessageId('-1001234567890_42')).toEqual({ peerId: '-1001234567890', msgId: 42 });
    expect(parseTelegramMessageId('-123456_7')).toEqual({ peerId: '-123456', msgId: 7 });
    expect(parseTelegramMessageId('987_1')).toEqual({ peerId: '987', msgId: 1 });
  });

  it('id legado (só número) ainda funciona, sem peer', () => {
    expect(parseTelegramMessageId('42')).toEqual({ peerId: null, msgId: 42 });
  });

  it('id provisório de mídia, id de WhatsApp e vazio não fazem parse', () => {
    expect(parseTelegramMessageId('tg-0a1b2c3d4e5f6a7b')).toBeNull();
    expect(parseTelegramMessageId('3EB0C431C26A1916E5A2')).toBeNull();
    expect(parseTelegramMessageId('')).toBeNull();
    expect(parseTelegramMessageId(null)).toBeNull();
    expect(parseTelegramMessageId('-100_0')).toBeNull();
  });
});
