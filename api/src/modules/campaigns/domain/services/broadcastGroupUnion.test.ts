import { describe, expect, it } from 'vitest';
import { countDistinctBroadcastGroups } from './broadcastGroupUnion';

type Row = { sessionId: string; groupJid: string; engine?: string | null; source: 'generator' | 'monitor' };
const engineOf = (r: Row) => r.engine;

describe('countDistinctBroadcastGroups', () => {
  it('vazio dá zero nos dois canais', () => {
    expect(countDistinctBroadcastGroups<Row>([], engineOf)).toEqual({ whatsapp: 0, telegram: 0 });
  });

  it('mesmo grupo no gerador e no monitor conta 1', () => {
    const rows: Row[] = [
      { sessionId: 's1', groupJid: 'g1', engine: 'baileys', source: 'generator' },
      { sessionId: 's1', groupJid: 'g1', engine: 'baileys', source: 'monitor' },
      { sessionId: 's1', groupJid: 'g1', engine: 'baileys', source: 'monitor' },
    ];
    expect(countDistinctBroadcastGroups(rows, engineOf)).toEqual({ whatsapp: 1, telegram: 0 });
  });

  it('mesmo JID em sessões diferentes conta 2', () => {
    const rows: Row[] = [
      { sessionId: 's1', groupJid: 'g1', engine: 'baileys', source: 'generator' },
      { sessionId: 's2', groupJid: 'g1', engine: 'baileys', source: 'monitor' },
    ];
    expect(countDistinctBroadcastGroups(rows, engineOf)).toEqual({ whatsapp: 2, telegram: 0 });
  });

  it('separa canais e trata engine ausente como WhatsApp', () => {
    const rows: Row[] = [
      { sessionId: 's1', groupJid: 'g1', engine: null, source: 'generator' },
      { sessionId: 's1', groupJid: 'g2', engine: undefined, source: 'monitor' },
      { sessionId: 't1', groupJid: '-100', engine: 'telegram', source: 'generator' },
      { sessionId: 't1', groupJid: '-100', engine: 'telegram', source: 'monitor' },
      { sessionId: 't1', groupJid: '-200', engine: 'telegram', source: 'monitor' },
    ];
    expect(countDistinctBroadcastGroups(rows, engineOf)).toEqual({ whatsapp: 2, telegram: 2 });
  });

  it('chave não colide por concatenação', () => {
    const rows: Row[] = [
      { sessionId: 'ab', groupJid: 'c', source: 'generator' },
      { sessionId: 'a', groupJid: 'bc', source: 'monitor' },
    ];
    expect(countDistinctBroadcastGroups(rows, engineOf).whatsapp).toBe(2);
  });
});
