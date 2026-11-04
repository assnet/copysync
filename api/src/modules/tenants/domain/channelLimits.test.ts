import { describe, expect, it } from 'vitest';
import { channelLimitKey, channelOfEngine, keepOneSessionPerChannel, requiresCrossSession, sliceByChannel } from './channelLimits';

describe('channelLimits', () => {
  it('chave por tipo e engine; engine desconhecida = WhatsApp', () => {
    expect(channelLimitKey('sessions', 'baileys')).toBe('whatsapp_sessions');
    expect(channelLimitKey('sessions', 'telegram')).toBe('telegram_sessions');
    expect(channelLimitKey('monitoredGroups', 'baileys')).toBe('monitored_groups');
    expect(channelLimitKey('monitoredGroups', 'telegram')).toBe('telegram_monitored_groups');
    expect(channelLimitKey('broadcastGroups', 'telegram')).toBe('telegram_broadcast_groups');
    expect(channelOfEngine(undefined)).toBe('whatsapp');
  });

  it('sessão cruzada só com 2+ sessões do mesmo canal', () => {
    expect(requiresCrossSession([{ id: 'a', engine: 'baileys' }, { id: 't', engine: 'telegram' }])).toBe(false);
    expect(requiresCrossSession([{ id: 'a', engine: 'baileys' }, { id: 'a', engine: 'baileys' }])).toBe(false);
    expect(requiresCrossSession([{ id: 'a', engine: 'baileys' }, { id: 'b', engine: 'baileys' }])).toBe(true);
  });

  it('uma sessão por canal (preferida no canal dela) e corte por canal', () => {
    const eng: Record<string, string> = { a: 'baileys', b: 'baileys', t1: 'telegram', t2: 'telegram' };
    const items = ['b', 't1', 'a', 't2'].map((s) => ({ s }));
    expect(keepOneSessionPerChannel(items, (i) => i.s, (id) => eng[id], { id: 'a', engine: 'baileys' }).map((i) => i.s)).toEqual(['t1', 'a']);
    const cut = sliceByChannel(['a', 't1', 'a', 't1', 't1'], (s) => eng[s], (c) => (c === 'telegram' ? 1 : null));
    expect(cut).toEqual(['a', 't1', 'a']);
  });
});
