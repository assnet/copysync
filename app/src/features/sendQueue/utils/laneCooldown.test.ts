import { describe, expect, it } from 'vitest';
import { laneCooldown } from './laneCooldown';
import type { SendQueueItem, SendQueueSession } from '@/types/api.types';

const item = (o: Partial<SendQueueItem>): SendQueueItem => ({
  dispatchId: 'd', offerId: 'o', origin: 'GENERATOR', offerStatus: 'SENDING', title: null, textPreview: '', imageUrl: null,
  coupon: null, conversationId: 'c', groupName: null, groupAvatarUrl: null, status: 'QUEUED',
  notBefore: '2026-10-28T12:10:00.000Z', claimedAt: null, updatedAt: '2026-10-28T12:00:00.000Z', failureReason: null, ...o,
});
const session = (o: Partial<SendQueueSession>): SendQueueSession => ({
  sessionId: 's', name: 'S', status: 'CONNECTED', running: null, waiting: [], recent: [],
  counts: { waiting: 0, paused: 0, sentToday: 0, failedToday: 0, skippedToday: 0 }, ...o,
});

describe('laneCooldown', () => {
  it('sem fila: null', () => {
    expect(laneCooldown(session({}))).toBeNull();
  });

  it('do início do envio em curso até o próximo', () => {
    const out = laneCooldown(session({
      running: item({ status: 'SENDING', claimedAt: '2026-10-28T12:05:00.000Z' }),
      waiting: [item({})],
    }));
    expect(out).toEqual({ startMs: Date.parse('2026-10-28T12:05:00.000Z'), endMs: Date.parse('2026-10-28T12:10:00.000Z') });
  });

  it('sem envio em curso usa o concluído mais recente', () => {
    const out = laneCooldown(session({ waiting: [item({})], recent: [item({ status: 'SENT', claimedAt: '2026-10-28T12:08:00.000Z' })] }));
    expect(out?.startMs).toBe(Date.parse('2026-10-28T12:08:00.000Z'));
  });

  it('pula envios de oferta pausada', () => {
    const out = laneCooldown(session({
      waiting: [item({ offerStatus: 'PAUSED', notBefore: '2026-10-28T12:01:00.000Z' }), item({ notBefore: '2026-10-28T12:20:00.000Z' })],
    }));
    expect(out?.endMs).toBe(Date.parse('2026-10-28T12:20:00.000Z'));
  });

  it('sem histórico: janela vazia (sai na hora)', () => {
    const out = laneCooldown(session({ waiting: [item({})] }));
    expect(out?.startMs).toBe(out?.endMs);
  });
});
