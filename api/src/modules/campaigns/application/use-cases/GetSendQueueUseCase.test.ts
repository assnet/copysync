import { describe, expect, it } from 'vitest';
import { GetSendQueueUseCase } from './GetSendQueueUseCase';
import type { ISendQueueReader, SendQueueEntry, SendQueueSnapshot } from '../../domain/contracts/ISendQueueReader';
import { NOW, TENANT } from './offerTestFakes';

const entry = (o: Partial<SendQueueEntry>): SendQueueEntry => ({
  dispatchId: 'd', offerId: 'o', origin: 'GENERATOR', offerStatus: 'SENDING', title: null, text: 'oferta', imageUrl: null,
  coupon: null, sessionId: 's1', conversationId: 'c', groupName: 'G', groupAvatarUrl: null, status: 'QUEUED',
  notBefore: NOW, claimedAt: null, updatedAt: NOW, failureReason: null, ...o,
});

function setup(snap: Partial<SendQueueSnapshot>) {
  const calls: unknown[] = [];
  const reader: ISendQueueReader = {
    async read(tenantId, options) {
      calls.push({ tenantId, options });
      return { sessions: [], open: [], recent: [], openCounts: [], finishedToday: [], ...snap };
    },
  };
  return { uc: new GetSendQueueUseCase({ reader, now: () => NOW }), calls };
}

describe('GetSendQueueUseCase', () => {
  it('agrupa por sessão: enviando, aguardando (pausados à parte) e contadores do dia', async () => {
    const { uc } = setup({
      sessions: [{ id: 's1', name: 'Loja', status: 'CONNECTED' }, { id: 's2', name: 'Outra', status: 'DISCONNECTED' }],
      open: [
        entry({ dispatchId: 'run', status: 'SENDING' }),
        entry({ dispatchId: 'w1' }),
        entry({ dispatchId: 'p1', offerStatus: 'PAUSED' }),
      ],
      recent: [entry({ dispatchId: 'r1', status: 'SENT' })],
      // Contagem exata vem do servidor, não do tamanho da lista
      openCounts: [{ sessionId: 's1', waiting: 140, paused: 1 }],
      finishedToday: [
        { sessionId: 's1', status: 'SENT', count: 4 },
        { sessionId: 's1', status: 'FAILED', count: 1 },
        { sessionId: 's1', status: 'SKIPPED', count: 2 },
      ],
    });
    const out = await uc.execute({ tenantId: TENANT });
    expect(out.serverTime).toBe(NOW.toISOString());
    expect(out.sessions.map((s) => s.sessionId)).toEqual(['s1', 's2']);
    const s1 = out.sessions[0]!;
    expect(s1.name).toBe('Loja');
    expect(s1.running?.dispatchId).toBe('run');
    expect(s1.waiting.map((w) => w.dispatchId)).toEqual(['w1', 'p1']);
    expect(s1.recent.map((w) => w.dispatchId)).toEqual(['r1']);
    expect(s1.counts).toEqual({ waiting: 140, paused: 1, sentToday: 4, failedToday: 1, skippedToday: 2 });
    expect(out.sessions[1]!.running).toBeNull();
  });

  it('lê com tenant, sessão e início do dia em São Paulo', async () => {
    const { uc, calls } = setup({});
    await uc.execute({ tenantId: TENANT, sessionId: 's1' });
    expect(calls[0]).toMatchObject({ tenantId: TENANT, options: { sessionId: 's1', since: new Date('2026-10-26T03:00:00.000Z') } });
  });

  it('corta o texto longo na prévia', async () => {
    const { uc } = setup({ sessions: [{ id: 's1', name: 'L', status: 'CONNECTED' }], open: [entry({ text: 'x'.repeat(500) })] });
    const out = await uc.execute({ tenantId: TENANT });
    expect(out.sessions[0]!.waiting[0]!.textPreview).toHaveLength(161);
  });

  it('envio antigo sem sessão aparece em grupo próprio só quando há algo', async () => {
    const { uc } = setup({ open: [entry({ sessionId: null })] });
    const out = await uc.execute({ tenantId: TENANT });
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0]!.sessionId).toBeNull();
  });
});
