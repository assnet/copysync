import { describe, expect, it } from 'vitest';
import type { OfferDispatchItem } from '@/types/api.types';
import { nextDispatchCooldown } from './dispatchCooldown';

const d = (id: string, status: OfferDispatchItem['status'], notBefore: string): OfferDispatchItem => ({
  id, conversationId: `c-${id}`, status, notBefore, chatMessageId: null, failureReason: null, waitingSession: false, updatedAt: notBefore,
});

describe('nextDispatchCooldown', () => {
  it('janela = notBefore anterior → notBefore do próximo na fila (fora de ordem na entrada)', () => {
    const r = nextDispatchCooldown([
      d('3', 'QUEUED', '2026-10-27T05:00:30.000Z'),
      d('1', 'SENT', '2026-10-27T05:00:00.000Z'),
      d('2', 'QUEUED', '2026-10-27T05:00:12.000Z'),
    ]);
    expect(r?.next.id).toBe('2');
    expect(r!.endMs - r!.startMs).toBe(12_000);
  });

  it('anterior ainda enviando conta como início da janela', () => {
    const r = nextDispatchCooldown([d('1', 'SENDING', '2026-10-27T05:00:00.000Z'), d('2', 'QUEUED', '2026-10-27T05:00:09.000Z')]);
    expect(r!.endMs - r!.startMs).toBe(9_000);
  });

  it('primeiro da fila: janela vazia; sem fila: null', () => {
    const first = nextDispatchCooldown([d('1', 'QUEUED', '2026-10-27T05:00:00.000Z')]);
    expect(first!.endMs).toBe(first!.startMs);
    expect(nextDispatchCooldown([d('1', 'SENT', '2026-10-27T05:00:00.000Z')])).toBeNull();
  });
});
