import { describe, expect, it } from 'vitest';
import { GROUP_JID_PATTERN } from './offer.schema';

const re = new RegExp(GROUP_JID_PATTERN);

describe('GROUP_JID_PATTERN', () => {
  it('aceita grupo do WhatsApp (novo e legado)', () => {
    expect(re.test('120363012345678901')).toBe(true);
    expect(re.test('5511999887766-1612345678')).toBe(true);
  });

  it('aceita grupo do Telegram (pequeno e supergrupo/canal)', () => {
    expect(re.test('-4512345678')).toBe(true);
    expect(re.test('-1001234567890')).toBe(true);
  });

  it('recusa sufixo, texto, negativo curto e com zero à esquerda', () => {
    for (const v of ['120363012345678901@g.us', 'abc', '-12', '-0123456', '--100123', '-100123456789012345678901', '']) {
      expect(re.test(v)).toBe(false);
    }
  });
});
