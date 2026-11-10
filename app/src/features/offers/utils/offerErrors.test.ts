import { describe, expect, it } from 'vitest';
import { toOfferError } from './offerErrors';

const limitErr = (key: string, limit: number) => ({ code: 'PLAN_LIMIT_REACHED', meta: { key, limit } });

describe('toOfferError — limite por canal', () => {
  it('grupos de disparo do Telegram citam o canal e abrem o aviso de upgrade', () => {
    const v = toOfferError(limitErr('telegram_broadcast_groups', 5));
    expect(v.message).toContain('Telegram');
    expect(v.planLimit).toEqual({ kind: 'telegramBroadcastGroups', limit: 5 });
  });

  it('destino sem permissão de postar: mensagem própria, sem ação', () => {
    const v = toOfferError({ code: 'GROUP_NOT_POSTABLE' });
    expect(v.message).toBe('Não dá para postar neste grupo. Escolha outro.');
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

describe('toOfferError — Shein', () => {
  it('Shein fora do plano: texto da Shein, não o de outra função', () => {
    const v = toOfferError({ code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: 'marketplace_shein_enabled' } });
    expect(v.message).toContain('Shein');
    expect(v.message).not.toContain('Marcar todos');
    expect(v.isLinkField).toBe(true);
  });

  it('aviso de risco não aceito: explica e leva às credenciais', () => {
    const v = toOfferError({ code: 'MARKETPLACE_RISK_NOT_ACCEPTED' });
    expect(v.message).toContain('aviso de risco');
    expect(v.action).toBe('credentials');
  });
});
