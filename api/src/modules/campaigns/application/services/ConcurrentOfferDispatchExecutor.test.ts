import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../../shared/logger/logger';
import type { OfferDispatch } from '../../domain/entities/OfferDispatch';
import { ConcurrentOfferDispatchExecutor, type OfferSendSlot } from './ConcurrentOfferDispatchExecutor';

const item = (id: string, sessionId: string | null) => ({ id, tenantId: 't', sessionId }) as OfferDispatch;

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Fila simples: uma seleção por sessão por claim, respeitando exclusões. */
function queue(sessions: Array<string | null>) {
  const pending = sessions.map((s, i) => item(`d${i}`, s));
  const calls: Array<{ limit: number; exclude: string[] }> = [];
  const claim = vi.fn(async (limit: number, exclude: string[]) => {
    calls.push({ limit, exclude });
    const out: OfferDispatch[] = [];
    for (const d of [...pending]) {
      if (out.length >= limit) break;
      if (d.sessionId && exclude.includes(d.sessionId)) continue;
      pending.splice(pending.indexOf(d), 1);
      out.push(d);
    }
    return out;
  });
  return { claim, calls, pending };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('ConcurrentOfferDispatchExecutor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('claim só das vagas livres; terceira sessão espera vaga; refill na mesma rodada', async () => {
    const ex = new ConcurrentOfferDispatchExecutor({ capacity: 2, maxItemsPerRound: 10 });
    const q = queue(['s1', 's2', 's3']);
    const sends = new Map<string, ReturnType<typeof deferred>>();
    let inFlight = 0;
    let maxInFlight = 0;
    const process = vi.fn(async (d: OfferDispatch, slot: OfferSendSlot) => {
      const send = deferred();
      sends.set(d.sessionId!, send);
      slot.holdUntil(send.promise);
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await send.promise.finally(() => inFlight--);
    });
    const round = ex.runRound({ claim: q.claim, process });
    await flush();
    expect(q.calls[0]).toEqual({ limit: 2, exclude: [] });
    expect([...sends.keys()]).toEqual(['s1', 's2']);
    sends.get('s1')!.resolve();
    await flush();
    expect([...sends.keys()]).toEqual(['s1', 's2', 's3']);
    // Refill: só a vaga liberada; exclui s1 (já escolhida) e s2 (sender pendente)
    expect(q.calls[1]).toEqual({ limit: 1, exclude: ['s1', 's2'] });
    sends.get('s2')!.resolve();
    sends.get('s3')!.resolve();
    expect(await round).toEqual({ processed: 3 });
    expect(maxInFlight).toBe(2);
    expect(ex.freeSlots).toBe(2);
  });

  it('item sem envio libera a vaga no fim; erro de um não derruba o outro', async () => {
    const ex = new ConcurrentOfferDispatchExecutor({ capacity: 2, maxItemsPerRound: 10 });
    const q = queue(['s1', 's2']);
    const err = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    const done: string[] = [];
    const r = await ex.runRound({
      claim: q.claim,
      process: async (d) => {
        if (d.sessionId === 's1') throw new Error('x');
        done.push(d.id);
      },
    });
    expect(r).toEqual({ processed: 2 });
    expect(done).toEqual(['d1']);
    expect(err).toHaveBeenCalledWith(expect.objectContaining({ dispatchId: 'd0' }), 'offer dispatch processing failed');
    expect(ex.freeSlots).toBe(2);
  });

  it('vaga segue a promise original: item termina (timeout) e a sessão fica excluída entre rodadas', async () => {
    const ex = new ConcurrentOfferDispatchExecutor({ capacity: 2, maxItemsPerRound: 10 });
    const stuck = deferred();
    const q = queue(['s1']);
    await ex.runRound({ claim: q.claim, process: async (_d, slot) => { slot.holdUntil(stuck.promise); } });
    expect(ex.unsettled().unsettledSenders).toBe(1);
    expect(ex.freeSlots).toBe(1);
    q.pending.push(item('n1', 's1'), item('n2', 's2'));
    await vi.advanceTimersByTimeAsync(130_000);
    const seen: string[] = [];
    await ex.runRound({ claim: q.claim, process: async (d) => { seen.push(d.id); } });
    // Vaga livre existe, mas s1 continua de fora até a promise original terminar
    expect(seen).toEqual(['n2']);
    expect(q.calls.at(-2)).toEqual({ limit: 1, exclude: ['s1'] });
    stuck.resolve();
    await flush();
    expect(ex.freeSlots).toBe(2);
    await ex.runRound({ claim: q.claim, process: async (d) => { seen.push(d.id); } });
    expect(seen).toEqual(['n2', 'n1']);
  });

  it('rejeição tardia da promise original também libera a vaga', async () => {
    const ex = new ConcurrentOfferDispatchExecutor({ capacity: 2, maxItemsPerRound: 10 });
    const late = deferred();
    await ex.runRound({ claim: queue(['s1']).claim, process: async (_d, slot) => { slot.holdUntil(late.promise); } });
    late.reject(new Error('late'));
    await flush();
    expect(ex.freeSlots).toBe(2);
  });

  it('duas promises eternas: rodadas seguintes sem claim nem busy loop; alerta ≤ 1/min após 120 s', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    vi.spyOn(logger, 'info').mockImplementation(() => undefined as never);
    const ex = new ConcurrentOfferDispatchExecutor({ capacity: 2, maxItemsPerRound: 10 });
    const q = queue(['s1', 's2', 's3']);
    const never = new Promise<void>(() => undefined);
    await ex.runRound({ claim: q.claim, process: async (_d, slot) => { slot.holdUntil(never); } });
    expect(ex.unsettled().unsettledSenders).toBe(2);
    const claimsBefore = q.claim.mock.calls.length;
    const process = vi.fn();
    // 3 min de rodadas a cada 2 s
    for (let t = 0; t < 90; t++) {
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await ex.runRound({ claim: q.claim, process })).toEqual({ processed: 0 });
    }
    expect(q.claim.mock.calls.length).toBe(claimsBefore);
    expect(process).not.toHaveBeenCalled();
    const alerts = warn.mock.calls.filter((c) => c[1] === 'offer dispatch sender unsettled beyond hold');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.length).toBeLessThanOrEqual(2);
    expect(alerts[0]![0]).toMatchObject({ unsettledSenders: 2, freeSlots: 0 });
    expect(q.pending.map((d) => d.id)).toEqual(['d2']);
  });

  it('refill limitado a maxItemsPerRound e no máximo uma busca vazia', async () => {
    const ex = new ConcurrentOfferDispatchExecutor({ capacity: 2, maxItemsPerRound: 10 });
    const q = queue(Array.from({ length: 12 }, (_, i) => `s${i}`));
    expect(await ex.runRound({ claim: q.claim, process: async () => undefined })).toEqual({ processed: 10 });
    expect(q.calls.every((c) => c.limit <= 2)).toBe(true);
    expect(q.calls.reduce((n, c) => n + c.limit, 0)).toBe(10);
    expect(q.pending).toHaveLength(2);

    const small = queue(['a', 'b', 'c']);
    expect(await ex.runRound({ claim: small.claim, process: async () => undefined })).toEqual({ processed: 3 });
    // 2 + 1 + busca vazia
    expect(small.calls).toHaveLength(3);
  });

  it('uma vaga presa: até 10 claims de 1 item por rodada, mais no máximo uma busca vazia', async () => {
    const ex = new ConcurrentOfferDispatchExecutor({ capacity: 2, maxItemsPerRound: 10 });
    await ex.runRound({ claim: queue(['stuck']).claim, process: async (_d, slot) => { slot.holdUntil(new Promise(() => undefined)); } });
    const many = queue(Array.from({ length: 12 }, (_, i) => `s${i}`));
    expect(await ex.runRound({ claim: many.claim, process: async () => undefined })).toEqual({ processed: 10 });
    expect(many.calls).toHaveLength(10);
    expect(many.calls.every((c) => c.limit === 1 && c.exclude.includes('stuck'))).toBe(true);
    const few = queue(['a', 'b']);
    expect(await ex.runRound({ claim: few.claim, process: async () => undefined })).toEqual({ processed: 2 });
    expect(few.calls).toHaveLength(3);
  });

  it('itens sem sessão (legado) não entram nas exclusões', async () => {
    const ex = new ConcurrentOfferDispatchExecutor({ capacity: 2, maxItemsPerRound: 10 });
    const q = queue([null, null, null]);
    expect(await ex.runRound({ claim: q.claim, process: async () => undefined })).toEqual({ processed: 3 });
    expect(q.calls.every((c) => c.exclude.length === 0)).toBe(true);
  });

  it('parada: nenhum claim novo; espera só o que começou', async () => {
    const ex = new ConcurrentOfferDispatchExecutor({ capacity: 2, maxItemsPerRound: 10 });
    const ac = new AbortController();
    const q = queue(['s1', 's2', 's3']);
    const r = await ex.runRound({ signal: ac.signal, claim: q.claim, process: async () => { await Promise.resolve(); ac.abort(); } });
    expect(r).toEqual({ processed: 2 });
    expect(q.claim).toHaveBeenCalledTimes(1);
  });

  it('abort durante o claim: itens já claimados não rodam (ficam SENDING para o releaseStale)', async () => {
    const ex = new ConcurrentOfferDispatchExecutor({ capacity: 2, maxItemsPerRound: 10 });
    const ac = new AbortController();
    const q = queue(['s1', 's2']);
    const claim = vi.fn(async (limit: number, exclude: string[]) => {
      const out = await q.claim(limit, exclude);
      ac.abort();
      return out;
    });
    const process = vi.fn(async () => undefined);
    const r = await ex.runRound({ signal: ac.signal, claim, process });
    expect(process).not.toHaveBeenCalled();
    expect(r).toEqual({ processed: 0 });
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('erro no claim propaga depois de aguardar os itens em andamento', async () => {
    const ex = new ConcurrentOfferDispatchExecutor({ capacity: 2, maxItemsPerRound: 10 });
    let n = 0;
    const finished: string[] = [];
    const claim = vi.fn(async () => {
      if (n++ === 0) return [item('d0', 's1')];
      throw new Error('db');
    });
    const round = ex.runRound({
      claim,
      process: async (d) => { await new Promise((r) => setTimeout(r, 10)); finished.push(d.id); },
    });
    const outcome = round.then(() => null, (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(20);
    expect(await outcome).toBe('db');
    expect(finished).toEqual(['d0']);
  });
});
