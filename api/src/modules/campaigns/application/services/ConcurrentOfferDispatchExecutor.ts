import type { OfferDispatch } from '../../domain/entities/OfferDispatch';
import { logger } from '../../../../shared/logger/logger';

/**
 * Vaga de uma chamada ao sender (entrega B, `OFFER_DISPATCH_CONCURRENCY=2`). Tomada no claim do item;
 * `holdUntil` transfere a posse para a promise ORIGINAL do `IOfferMessageSender.send`, que a libera
 * só ao terminar (não no timeout do `Promise.race`). Sem `holdUntil`, `release` no fim do item.
 */
export interface OfferSendSlot {
  readonly sessionId: string | null;
  /** Chamar ANTES de iniciar o envio, com a promise original. */
  holdUntil(send: Promise<unknown>): void;
  /** Fim do item sem envio (ou já transferido: no-op). Idempotente. */
  release(): void;
}

export interface ConcurrentRoundInput {
  signal?: AbortSignal;
  /** Claim com `now` novo. `excludeSessionIds` = sessões da rodada ∪ sessões com sender pendente. */
  claim(limit: number, excludeSessionIds: string[]): Promise<OfferDispatch[]>;
  /** Processa um item; deve chamar `slot.holdUntil` antes do sender. Erro é logado aqui. */
  process(dispatch: OfferDispatch, slot: OfferSendSlot): Promise<void>;
}

export interface ConcurrentOfferDispatchExecutorOptions {
  capacity: number;
  /** Teto de itens por rodada (refill). */
  maxItemsPerRound: number;
  /** Relógio monotônico em ms (idade das chamadas pendentes). */
  clock?: () => number;
  /** Idade a partir da qual a chamada pendente vira alerta (padrão 120 s, o hold do SEND_TIMEOUT). */
  unsettledAlertMs?: number;
  /** Intervalo mínimo entre resumos/alertas no log (padrão 60 s). */
  reportIntervalMs?: number;
}

export const UNSETTLED_SENDER_ALERT_MS = 120_000;
const REPORT_INTERVAL_MS = 60_000;

interface Held {
  sessionId: string | null;
  /** Início do envio (null = item ainda preparando, sem sender). */
  sendingSince: number | null;
}

/**
 * Executor do modo 2 (design B): reivindica só as vagas livres, com `now` novo a cada claim, até
 * `maxItemsPerRound` itens por rodada, uma seleção por sessão por rodada. Nada fica pré-reivindicado
 * esperando vaga. As vagas são estado transitório deste processo (no máximo `capacity` entradas) e
 * sobrevivem entre rodadas enquanto a promise original do sender não termina; fila, posse, hold de
 * SEND_TIMEOUT e resultado continuam no Postgres. Promise eterna mantém a vaga: a rodada termina sem
 * novos claims (sem busy loop) e o log alerta no máximo uma vez por intervalo.
 */
export class ConcurrentOfferDispatchExecutor {
  private readonly held = new Map<number, Held>();
  private seq = 0;
  private releaseWaiters: Array<() => void> = [];
  private lastReportAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly opts: ConcurrentOfferDispatchExecutorOptions) {}

  private now(): number {
    return (this.opts.clock ?? Date.now)();
  }

  get freeSlots(): number {
    return Math.max(0, this.opts.capacity - this.held.size);
  }

  /** Chamadas ao sender ainda pendentes (inclusive após SEND_TIMEOUT) e idade da mais antiga. */
  unsettled(): { unsettledSenders: number; oldestUnsettledMs: number | null } {
    let count = 0;
    let oldest: number | null = null;
    const now = this.now();
    for (const h of this.held.values()) {
      if (h.sendingSince === null) continue;
      count++;
      const age = now - h.sendingSince;
      if (oldest === null || age > oldest) oldest = age;
    }
    return { unsettledSenders: count, oldestUnsettledMs: oldest };
  }

  private heldSessionIds(): string[] {
    const ids: string[] = [];
    for (const h of this.held.values()) if (h.sessionId) ids.push(h.sessionId);
    return ids;
  }

  private acquire(sessionId: string | null): OfferSendSlot {
    const key = ++this.seq;
    const entry: Held = { sessionId, sendingSince: null };
    this.held.set(key, entry);
    let transferred = false;
    const free = () => {
      if (!this.held.delete(key)) return;
      const waiters = this.releaseWaiters;
      this.releaseWaiters = [];
      for (const w of waiters) w();
    };
    return {
      sessionId,
      holdUntil: (send) => {
        if (transferred || !this.held.has(key)) return;
        transferred = true;
        entry.sendingSince = this.now();
        // Libera só quando a chamada original terminar (sucesso ou erro), nunca no timeout
        send.then(free, free);
      },
      release: () => {
        if (!transferred) free();
      },
    };
  }

  /** Resolve na próxima liberação de vaga (uma lista limitada às esperas da rodada em curso). */
  private nextRelease(): Promise<void> {
    return new Promise((resolve) => this.releaseWaiters.push(resolve));
  }

  async runRound(input: ConcurrentRoundInput): Promise<{ processed: number }> {
    const { signal } = input;
    const chosen = new Set<string>();
    const active = new Set<Promise<void>>();
    let claimed = 0;
    let skipped = 0;
    let exhausted = false;
    let claimError: unknown = null;

    while (!signal?.aborted) {
      const room = Math.min(this.freeSlots, this.opts.maxItemsPerRound - claimed);
      if (room > 0 && !exhausted) {
        let due: OfferDispatch[];
        try {
          due = await input.claim(room, [...new Set([...chosen, ...this.heldSessionIds()])]);
        } catch (err) {
          claimError = err;
          break;
        }
        // Busca vazia: não há mais elegível agora; só espera o que já começou
        if (due.length === 0) exhausted = true;
        for (const d of due) {
          claimed++;
          if (d.sessionId) chosen.add(d.sessionId);
          // Abort chegou durante o claim: não toca o item; fica SENDING até o releaseStale
          if (signal?.aborted) {
            skipped++;
            continue;
          }
          const slot = this.acquire(d.sessionId);
          const task: Promise<void> = input
            .process(d, slot)
            .catch((err) => {
              // Envio fica SENDING; releaseStale devolve à fila
              logger.error({ err: (err as Error)?.name, dispatchId: d.id, tenantId: d.tenantId }, 'offer dispatch processing failed');
            })
            .finally(() => {
              slot.release();
              active.delete(task);
            });
          active.add(task);
        }
        continue;
      }
      // Nada desta rodada em andamento: acabou (teto, fila vazia ou vagas presas em senders antigos)
      if (active.size === 0) break;
      // Espera um item terminar ou uma vaga voltar; nunca gira sem uma promise real pendente
      await Promise.race([...active, this.nextRelease()]);
    }

    if (signal?.aborted && claimed > 0) logger.info({ inFlight: active.size, skipped }, 'offer dispatch concurrent round stopping');
    await Promise.allSettled([...active]);
    // Esperas não resolvidas desta rodada não precisam sobreviver a ela
    this.releaseWaiters = [];
    this.report();
    if (claimError) throw claimError;
    return { processed: claimed - skipped };
  }

  /** Resumo/alerta limitado a um por intervalo: só quando há chamada ao sender pendente. */
  private report(): void {
    try {
      const u = this.unsettled();
      if (u.unsettledSenders === 0) return;
      const now = this.now();
      if (now - this.lastReportAt < (this.opts.reportIntervalMs ?? REPORT_INTERVAL_MS)) return;
      this.lastReportAt = now;
      const payload = { ...u, freeSlots: this.freeSlots, capacity: this.opts.capacity };
      if ((u.oldestUnsettledMs ?? 0) > (this.opts.unsettledAlertMs ?? UNSETTLED_SENDER_ALERT_MS)) {
        logger.warn(payload, 'offer dispatch sender unsettled beyond hold');
      } else {
        logger.info(payload, 'offer dispatch senders in flight');
      }
    } catch {
      // observação é melhor esforço
    }
  }
}
