import { describe, expect, it } from 'vitest';
import { channelCaps, channelLimit, planLimitHit, upsellKindOf, visibleChannels } from './channelLimits';
import { monitoringErrorMessage } from './apiErrors';

const config = {
  limits: {
    monitoredGroups: 10, broadcastGroups: 5, mentionAllEnabled: true, crossSessionDispatch: false,
    whatsapp: { monitoredGroups: 10, broadcastGroups: 5 },
    telegram: { monitoredGroups: 4, broadcastGroups: null },
  },
  usage: { monitoredGroups: 6, broadcastGroups: 5, whatsapp: { monitoredGroups: 6, broadcastGroups: 5 }, telegram: { monitoredGroups: 3, broadcastGroups: 1 } },
};

describe('limites por canal do monitoramento', () => {
  it('máximo desta lista por canal desconta só as outras sessões do mesmo canal', () => {
    expect(channelCaps(config, 'monitoredGroups', { whatsapp: 2, telegram: 1 })).toEqual({ whatsapp: 6, telegram: 2 });
    expect(channelCaps(config, 'broadcastGroups', { whatsapp: 0, telegram: 1 })).toEqual({ whatsapp: 0, telegram: null });
  });

  it('API antiga sem bloco por canal: raiz = WhatsApp, Telegram sem limite', () => {
    const legacy = { limits: { ...config.limits, whatsapp: undefined, telegram: undefined }, usage: config.usage } as never;
    expect(channelLimit(legacy, 'whatsapp', 'broadcastGroups')).toBe(5);
    expect(channelLimit(legacy, 'telegram', 'broadcastGroups')).toBeNull();
  });

  it('canais visíveis seguem as sessões do tenant', () => {
    expect(visibleChannels([{ engine: 'telegram' }, { engine: 'baileys' }], 'whatsapp')).toEqual(['whatsapp', 'telegram']);
    expect(visibleChannels([], 'telegram')).toEqual(['telegram']);
  });

  it('PLAN_LIMIT_REACHED por chave → canal, mensagem e upgrade', () => {
    const err = { code: 'PLAN_LIMIT_REACHED', meta: { key: 'telegram_broadcast_groups', limit: 4 } };
    const hit = planLimitHit(err)!;
    expect(hit).toEqual({ kind: 'broadcastGroups', channel: 'telegram', limit: 4 });
    expect(upsellKindOf(hit)).toBe('telegramBroadcastGroups');
    expect(monitoringErrorMessage(err, { scope: 'groups' })).toBe('Seu plano permite até 4 grupos de disparo no Telegram, somando todas as sessões. Remova algum ou veja os planos.');
    expect(upsellKindOf(planLimitHit({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'monitored_groups', limit: 1 } })!)).toBe('whatsappMonitoredGroups');
    expect(planLimitHit({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'offers_per_day' } })).toBeNull();
  });
});
