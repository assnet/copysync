import { describe, expect, it } from 'vitest';
import { toOfferError } from './offerErrors';

const limitErr = (key: string, limit: number) => ({ code: 'PLAN_LIMIT_REACHED', meta: { key, limit } });

describe('toOfferError — limite por canal', () => {
  it('grupos de disparo do Telegram citam o canal e abrem o aviso de upgrade', () => {
    const v = toOfferError(limitErr('telegram_broadcast_groups', 5));
    expect(v.message).toContain('Telegram');
    expect(v.planLimit).toEqual({ kind: 'telegramBroadcastGroups', limit: 5 });
  });

  it('canal só de leitura como destino: mensagem própria, sem ação', () => {
    const v = toOfferError({ code: 'GROUP_NOT_POSTABLE' });
    expect(v.message).toMatch(/só de leitura/);
    expect(v.action).toBe('none');
  });

  it('sessões de WhatsApp viram aviso de sessões', () => {
    const v = toOfferError(limitErr('whatsapp_sessions', 1));
    expect(v.message).toContain('WhatsApp');
    expect(v.planLimit?.kind).toBe('whatsappSessions');
  });

  it('limite diário segue sem aviso de upgrade', () => {
    const v = toOfferError({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'offers_per_day', limit: 10 } });
    expect(v.planLimit).toBeUndefined();
  });
});
