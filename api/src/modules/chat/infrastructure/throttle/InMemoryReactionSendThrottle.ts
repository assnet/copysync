import type {
  IReactionSendThrottle,
  ReactionSendReservation,
} from '../../application/contracts/IReactionSendThrottle';

/** Janela deslizante do teto por sessão. */
const WINDOW_MS = 60_000;

export interface InMemoryReactionSendThrottleOptions {
  /** Intervalo mínimo entre envios na mesma mensagem (`REACTION_MIN_INTERVAL_MS`). */
  minIntervalMs: number;
  /** Teto de envios por sessão na janela de um minuto (`REACTION_MAX_PER_MINUTE`). */
  maxPerMinute: number;
  now?: () => number;
}

interface Slot extends ReactionSendReservation {
  readonly at: number;
}

/**
 * Limite de envio de reações em memória, por instância da API.
 *
 * Não é estado crítico: perder os contadores num restart só afrouxa o limite por um minuto.
 * Uma única instância deve ser compartilhada pelo módulo — instância por requisição zeraria o
 * limite. Entradas vencidas são varridas a cada janela, então a memória fica limitada ao
 * volume do último minuto.
 */
export class InMemoryReactionSendThrottle implements IReactionSendThrottle {
  /** sessionId → vagas da janela, em ordem de reserva. */
  private readonly bySession = new Map<string, Slot[]>();
  /** sessionId + messageId → última vaga daquela mensagem. */
  private readonly byMessage = new Map<string, Slot>();
  private readonly now: () => number;
  private lastSweepAt: number;

  constructor(private readonly options: InMemoryReactionSendThrottleOptions) {
    this.now = options.now ?? Date.now;
    this.lastSweepAt = this.now();
  }

  tryAcquire(sessionId: string, messageId: string): ReactionSendReservation | null {
    const now = this.now();
    this.sweep(now);

    const key = messageKey(sessionId, messageId);
    const last = this.byMessage.get(key);
    if (last && now - last.at < this.options.minIntervalMs) return null;

    const window = this.windowOf(sessionId, now);
    if (window.length >= this.options.maxPerMinute) return null;

    // Checagem e registro no mesmo passo síncrono: nenhuma outra aquisição passa no meio.
    const slot: Slot = { sessionId, messageId, at: now };
    window.push(slot);
    this.bySession.set(sessionId, window);
    this.byMessage.set(key, slot);
    return slot;
  }

  release(reservation: ReactionSendReservation): void {
    const window = this.bySession.get(reservation.sessionId);
    const index = window ? window.indexOf(reservation as Slot) : -1;
    if (window && index >= 0) {
      window.splice(index, 1);
      if (window.length === 0) this.bySession.delete(reservation.sessionId);
    }

    const key = messageKey(reservation.sessionId, reservation.messageId);
    if (this.byMessage.get(key) === reservation) this.byMessage.delete(key);
  }

  /** Vagas da sessão ainda dentro da janela (as vencidas saem aqui). */
  private windowOf(sessionId: string, now: number): Slot[] {
    const window = this.bySession.get(sessionId) ?? [];
    const firstAlive = window.findIndex((s) => now - s.at < WINDOW_MS);
    if (firstAlive < 0) return [];
    if (firstAlive > 0) window.splice(0, firstAlive);
    return window;
  }

  /** Remove sessões e mensagens sem vaga viva — sem isso os mapas cresceriam sem limite. */
  private sweep(now: number): void {
    if (now - this.lastSweepAt < WINDOW_MS) return;
    this.lastSweepAt = now;

    for (const [key, slot] of this.byMessage) {
      if (now - slot.at >= this.options.minIntervalMs) this.byMessage.delete(key);
    }
    for (const sessionId of [...this.bySession.keys()]) {
      if (this.windowOf(sessionId, now).length === 0) this.bySession.delete(sessionId);
    }
  }

  /** Quantidade de chaves guardadas — só para teste da limpeza. */
  get trackedKeys(): number {
    return this.bySession.size + this.byMessage.size;
  }
}

function messageKey(sessionId: string, messageId: string): string {
  return `${sessionId}\u0000${messageId}`;
}
