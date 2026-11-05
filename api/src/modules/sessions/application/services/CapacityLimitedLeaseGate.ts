import { acquireLeaseResult, type ISessionLeaseGate, type LeaseAcquireResult } from '../../domain/contracts/ISessionLeaseRepository';
import { logger } from '../../../../shared/logger/logger';

export type CapacityGateLogger = Pick<typeof logger, 'warn'>;

/** Tempo máximo que uma reserva de abertura bem-sucedida segura a vaga até a sessão aparecer em `listLocal`. */
export const CAPACITY_RESERVATION_TTL_MS = 15_000;

/**
 * Teto de sessões no gate do lease (ADOPT-06). Decora o gate real (`AcquireSessionLeaseUseCase`):
 * sessão já local (inclui socket abrindo) sempre repassa; com `ativas >= max` nega sessão nova.
 * `ativas` = `listLocal()` + reservas em voo (T22): a vaga é reservada de forma síncrona antes do
 * `inner.acquire`, senão aberturas simultâneas (session-open, rota, ticker) passariam todas com
 * `local = max-1`. Reserva sai na hora em falha/negação; em sucesso, quando a sessão aparece em
 * `listLocal` ou após `reservationTtlMs`. Sessão já reservada repassa sem reservar de novo.
 * `false` cai no 503 existente da rota (D3). Sem env: `max` e `listLocal` vêm de quem monta.
 */
export class CapacityLimitedLeaseGate implements ISessionLeaseGate {
  private readonly reserved = new Map<string, ReturnType<typeof setTimeout> | null>();

  constructor(
    private readonly inner: ISessionLeaseGate,
    private readonly listLocal: () => string[],
    private readonly max: number,
    private readonly log: CapacityGateLogger = logger.child({ module: 'CapacityLimitedLeaseGate' }),
    private readonly reservationTtlMs = CAPACITY_RESERVATION_TTL_MS,
  ) {}

  async acquire(sessionId: string): Promise<boolean> {
    const slot = this.reserve(sessionId);
    if (slot === 'denied') return false;
    try {
      const ok = await this.inner.acquire(sessionId);
      this.settle(slot, sessionId, ok);
      return ok;
    } catch (err) {
      this.settle(slot, sessionId, false);
      this.log.warn({ err, sessionId }, 'falha ao adquirir lease de sessão');
      return false;
    }
  }

  /** Teto atingido conta como `held` (não é este processo que deve abrir); erro do gate interno = `error`. */
  async acquireResult(sessionId: string): Promise<LeaseAcquireResult> {
    const slot = this.reserve(sessionId);
    if (slot === 'denied') return 'held';
    const result = await acquireLeaseResult(this.inner, sessionId);
    this.settle(slot, sessionId, result === 'acquired');
    return result;
  }

  /** Síncrono: decide e reserva antes de qualquer `await`. `pass` = já local ou já reservada (não reserva). */
  private reserve(sessionId: string): 'reserved' | 'pass' | 'denied' {
    const local = this.listLocal();
    this.pruneLocal(local);
    if (local.includes(sessionId) || this.reserved.has(sessionId)) return 'pass';
    const active = local.length + this.reserved.size;
    if (active >= this.max) {
      this.log.warn({ sessionId, active, max: this.max }, 'teto de sessões atingido; lease negado');
      return 'denied';
    }
    this.reserved.set(sessionId, null);
    return 'reserved';
  }

  private settle(slot: 'reserved' | 'pass', sessionId: string, ok: boolean): void {
    if (slot !== 'reserved') return;
    if (!ok || this.listLocal().includes(sessionId)) return this.freeSlot(sessionId);
    const timer = setTimeout(() => this.reserved.delete(sessionId), this.reservationTtlMs);
    timer.unref?.();
    this.reserved.set(sessionId, timer);
  }

  /** Reserva de sessão que já aparece em `listLocal` sai (não conta duas vezes). */
  private pruneLocal(local: string[]): void {
    for (const id of this.reserved.keys()) if (local.includes(id)) this.freeSlot(id);
  }

  private freeSlot(sessionId: string): void {
    const timer = this.reserved.get(sessionId);
    if (timer) clearTimeout(timer);
    this.reserved.delete(sessionId);
  }
}
