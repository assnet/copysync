import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../../shared/logger/logger';
import type { ClaimDueOptions } from '../../domain/contracts/IOfferDispatchRepository';
import { ProcessDueOfferDispatchesUseCase } from './ProcessDueOfferDispatchesUseCase';
import { InMemoryOfferDispatchRepository, InMemoryOfferRepository, makeOffer, NOW } from './offerTestFakes';

/**
 * Entrega B (T7): modo 2 com o use case real e uma fila em memória com faixa por sessão (um
 * candidato por sessão, sessão SENDING ocupada, SEND_TIMEOUT segura 120 s), espelho do SQL.
 */
class LaneDispatchRepository extends InMemoryOfferDispatchRepository {
  constructor(private readonly offerRepo: InMemoryOfferRepository) {
    super(offerRepo);
  }
  claims: Array<{ limit: number; exclude: string[] }> = [];
  private tok = 0;
  async claimDue(now: Date, limit: number, options: ClaimDueOptions = {}) {
    const excluded = [...(options.excludeSessionIds ?? [])];
    this.claims.push({ limit, exclude: excluded });
    const busy = (sid: string) => this.items.some((d) => d.sessionId === sid && (d.status === 'SENDING'
      || (d.status === 'FAILED' && d.failureReason === 'SEND_TIMEOUT' && d.claimedAt && now.getTime() - d.claimedAt.getTime() < 120_000)));
    const heads = new Set<string>();
    const due = [];
    for (const d of this.items) {
      if (due.length >= limit) break;
      if (d.status !== 'QUEUED' || d.notBefore > now) continue;
      if (this.offerRepo.items.find((o) => o.id === d.offerId)?.status !== 'SENDING') continue;
      const lane = d.sessionId ?? d.id;
      if (heads.has(lane)) continue;
      heads.add(lane);
      if (d.sessionId && (excluded.includes(d.sessionId) || busy(d.sessionId))) continue;
      Object.assign(d, { status: 'SENDING', claimedAt: now, claimToken: `lane-${++this.tok}` });
      due.push({ ...d });
    }
    return due;
  }
  async touchClaim(id: string, claimToken: string) {
    return this.items.some((x) => x.id === id && x.claimToken === claimToken && x.status === 'SENDING');
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

type Sent = { chatMessageId: string };

/** Uma oferta por sessão (offer-<sessão>), um envio cada. */
function setup(sessions: string[], offer: Parameters<typeof makeOffer>[0] = {}) {
  const offers = new InMemoryOfferRepository();
  const dispatches = new LaneDispatchRepository(offers);
  for (const s of sessions) add(offers, dispatches, s, offer);
  const pending = new Map<string, ReturnType<typeof deferred<Sent>>>();
  const calls: string[] = [];
  const sender = {
    send: vi.fn((input: { conversationId: string; imageMode?: string; imageUrl?: string | null }) => {
      calls.push(input.conversationId);
      const d = deferred<Sent>();
      pending.set(input.conversationId, d);
      return d.promise;
    }),
  };
  const uc = new ProcessDueOfferDispatchesUseCase({ offers, dispatches, sender, now: () => new Date(Date.now()), sendTimeoutMs: 50 });
  return { offers, dispatches, sender, uc, pending, calls };
}

let convSeq = 0;
function add(offers: InMemoryOfferRepository, dispatches: InMemoryOfferDispatchRepository, sessionId: string, offer: Parameters<typeof makeOffer>[0] = {}) {
  const offerId = `offer-${sessionId}-${++convSeq}`;
  offers.items.push(makeOffer({ id: offerId, status: 'SENDING', ...offer }));
  return dispatches.add({ offerId, conversationId: `c-${sessionId}-${convSeq}`, sessionId, notBefore: new Date(Date.now()) });
}

const B = { concurrency: 2 as const };
const flush = () => vi.advanceTimersByTimeAsync(0);
const statusOf = (s: ReturnType<typeof setup>, sessionId: string) =>
  s.dispatches.items.filter((d) => d.sessionId === sessionId).map((d) => [d.status, d.failureReason ?? d.chatMessageId]);

describe('ProcessDueOfferDispatchesUseCase — concorrência 2 (entrega B)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    convSeq = 0;
    for (const l of ['info', 'warn', 'error'] as const) vi.spyOn(logger, l).mockImplementation(() => undefined as never);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('duas sessões progridem juntas; a terceira espera vaga e entra na mesma rodada', async () => {
    const s = setup(['s1', 's2', 's3']);
    const round = s.uc.execute(B);
    await flush();
    expect(s.calls).toEqual(['c-s1-1', 'c-s2-2']);
    expect(s.dispatches.claims[0]).toEqual({ limit: 2, exclude: [] });
    s.pending.get('c-s2-2')!.resolve({ chatMessageId: 'm2' });
    await flush();
    expect(s.calls).toEqual(['c-s1-1', 'c-s2-2', 'c-s3-3']);
    s.pending.get('c-s1-1')!.resolve({ chatMessageId: 'm1' });
    s.pending.get('c-s3-3')!.resolve({ chatMessageId: 'm3' });
    expect(await round).toEqual({ processed: 3 });
    expect(['s1', 's2', 's3'].map((x) => statusOf(s, x)[0]![0])).toEqual(['SENT', 'SENT', 'SENT']);
    expect(s.offers.items.every((o) => o.status === 'SENT')).toBe(true);
  });

  it('erro de uma sessão não descarta o resultado da outra', async () => {
    const s = setup(['s1', 's2']);
    const round = s.uc.execute(B);
    await flush();
    s.pending.get('c-s1-1')!.reject(new Error('boom'));
    s.pending.get('c-s2-2')!.resolve({ chatMessageId: 'm2' });
    await round;
    expect(statusOf(s, 's1')).toEqual([['FAILED', 'MESSAGE_SEND_FAILED']]);
    expect(statusOf(s, 's2')).toEqual([['SENT', 'm2']]);
  });

  it('sender além do timeout: SEND_TIMEOUT sem retry; vaga e sessão presas até o settle, inclusive após 120 s', async () => {
    const s = setup(['s1']);
    const r1 = s.uc.execute(B);
    await vi.advanceTimersByTimeAsync(60);
    expect(await r1).toEqual({ processed: 1 });
    expect(statusOf(s, 's1')).toEqual([['FAILED', 'SEND_TIMEOUT']]);
    expect(s.uc.unsettledSenders().unsettledSenders).toBe(1);

    // Hold do banco venceu; a sessão tem outro envio e há vaga livre: ainda assim não sai por s1
    await vi.advanceTimersByTimeAsync(130_000);
    add(s.offers, s.dispatches, 's1');
    add(s.offers, s.dispatches, 's2');
    const r2 = s.uc.execute(B);
    await flush();
    s.pending.get('c-s2-3')!.resolve({ chatMessageId: 'm' });
    expect(await r2).toEqual({ processed: 1 });
    expect(s.calls).toEqual(['c-s1-1', 'c-s2-3']);
    expect(s.dispatches.claims.at(-2)).toEqual({ limit: 1, exclude: ['s1'] });

    // Promise original termina tarde: vaga volta e a sessão pode ser escolhida de novo
    s.pending.get('c-s1-1')!.resolve({ chatMessageId: 'late' });
    await flush();
    expect(s.uc.unsettledSenders().unsettledSenders).toBe(0);
    const r3 = s.uc.execute(B);
    await flush();
    s.pending.get('c-s1-2')!.resolve({ chatMessageId: 'm' });
    await r3;
    expect(s.calls).toEqual(['c-s1-1', 'c-s2-3', 'c-s1-2']);
    // Resultado do timeout permanece (sem retry, sem reescrita tardia)
    expect(statusOf(s, 's1')).toEqual([['FAILED', 'SEND_TIMEOUT'], ['SENT', 'm']]);
  });

  it('dois senders eternos: estado degradado limitado a duas vagas, sem novos claims nem envios', async () => {
    const s = setup(['s1', 's2', 's3']);
    const r1 = s.uc.execute(B);
    await vi.advanceTimersByTimeAsync(60);
    await r1;
    const claims = s.dispatches.claims.length;
    for (let i = 0; i < 30; i++) {
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await s.uc.execute(B)).toEqual({ processed: 0 });
    }
    expect(s.dispatches.claims.length).toBe(claims);
    expect(s.sender.send).toHaveBeenCalledTimes(2);
    expect(s.uc.unsettledSenders()).toMatchObject({ unsettledSenders: 2 });
    expect(statusOf(s, 's3')).toEqual([['QUEUED', null]]);
  });

  it('uma seleção por sessão por rodada, mesmo com a faixa livre', async () => {
    const s = setup(['s1', 's2']);
    add(s.offers, s.dispatches, 's1');
    s.sender.send.mockResolvedValue({ chatMessageId: 'm' });
    expect(await s.uc.execute(B)).toEqual({ processed: 2 });
    expect(statusOf(s, 's1').map((x) => x[0])).toEqual(['SENT', 'QUEUED']);
    expect(await s.uc.execute(B)).toEqual({ processed: 1 });
    expect(statusOf(s, 's1').map((x) => x[0])).toEqual(['SENT', 'SENT']);
  });

  it('refill até 10 itens por rodada; nunca mais de 2 chamadas ao sender em voo', async () => {
    const s = setup(Array.from({ length: 12 }, (_, i) => `s${i}`));
    let inFlight = 0;
    let max = 0;
    s.sender.send.mockImplementation(async () => {
      inFlight++; max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { chatMessageId: 'm' };
    });
    const round = s.uc.execute(B);
    await vi.advanceTimersByTimeAsync(100);
    expect(await round).toEqual({ processed: 10 });
    expect(max).toBe(2);
    expect(s.dispatches.claims.every((c) => c.limit <= 2)).toBe(true);
    expect(s.dispatches.claims.reduce((n, c) => n + c.limit, 0)).toBe(10);
  });

  it('MEDIA (sai LINK_PREVIEW), texto e LINK_PREVIEW: a vaga cobre só a chamada ao sender, não a transferência da mídia', async () => {
    const s = setup([]);
    add(s.offers, s.dispatches, 'sm', { imageMode: 'MEDIA', imageUrl: 'store://1.jpg' });
    add(s.offers, s.dispatches, 'st', { imageUrl: null });
    add(s.offers, s.dispatches, 'sl', { imageMode: 'LINK_PREVIEW', imageUrl: 'store://2.jpg', title: 'Fone' });
    // Com foto: o sender devolve ao enfileirar; a transferência (fila de mídia, limites próprios) nunca termina aqui
    const transfers: Promise<void>[] = [];
    s.sender.send.mockImplementation(async (input) => {
      if (input.imageUrl) transfers.push(new Promise<void>(() => undefined));
      return { chatMessageId: 'm' };
    });
    expect(await s.uc.execute(B)).toEqual({ processed: 3 });
    // MEDIA desligado: a oferta salva MEDIA chega ao sender como LINK_PREVIEW
    expect(s.sender.send).toHaveBeenCalledWith(expect.objectContaining({ imageMode: 'LINK_PREVIEW', imageUrl: 'store://1.jpg' }));
    expect(s.sender.send).not.toHaveBeenCalledWith(expect.objectContaining({ imageMode: 'MEDIA' }));
    expect(s.sender.send).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: null }));
    expect(s.sender.send).toHaveBeenCalledWith(expect.objectContaining({ imageMode: 'LINK_PREVIEW', title: 'Fone' }));
    expect(transfers).toHaveLength(2);
    expect(s.uc.unsettledSenders().unsettledSenders).toBe(0);
  });

  it('erro síncrono do sender vira falha e devolve a vaga', async () => {
    const s = setup(['s1']);
    s.sender.send.mockImplementation(() => { throw new Error('sync'); });
    await s.uc.execute(B);
    expect(statusOf(s, 's1')).toEqual([['FAILED', 'MESSAGE_SEND_FAILED']]);
    expect(s.uc.unsettledSenders().unsettledSenders).toBe(0);
  });

  it('parada no meio da rodada: nenhum claim nem envio novo', async () => {
    const s = setup(['s1', 's2', 's3']);
    const ac = new AbortController();
    const round = s.uc.execute({ ...B, signal: ac.signal });
    await flush();
    ac.abort();
    s.pending.get('c-s1-1')!.resolve({ chatMessageId: 'm' });
    s.pending.get('c-s2-2')!.resolve({ chatMessageId: 'm' });
    expect(await round).toEqual({ processed: 2 });
    expect(s.dispatches.claims).toHaveLength(1);
    expect(statusOf(s, 's3')).toEqual([['QUEUED', null]]);
  });
});

describe('ProcessDueOfferDispatchesUseCase — concorrência 1 (padrão)', () => {
  it('sem contexto ou com 1: claim único de sempre, sem exclusões', async () => {
    for (const ctx of [undefined, { concurrency: 1 as const }]) {
      const offers = new InMemoryOfferRepository();
      offers.items.push(makeOffer({ status: 'SENDING' }));
      const dispatches = new InMemoryOfferDispatchRepository(offers);
      dispatches.add({ offerId: 'offer-1', conversationId: 'c1', sessionId: 's1' });
      const claim = vi.spyOn(dispatches, 'claimDue');
      const uc = new ProcessDueOfferDispatchesUseCase({ offers, dispatches, sender: { send: vi.fn().mockResolvedValue({ chatMessageId: 'm' }) }, now: () => NOW });
      expect(await uc.execute(ctx)).toEqual({ processed: 1 });
      expect(claim).toHaveBeenCalledTimes(1);
      expect(claim.mock.calls[0]).toEqual([NOW, 10]);
      expect(uc.unsettledSenders()).toEqual({ unsettledSenders: 0, oldestUnsettledMs: null });
    }
  });
});
