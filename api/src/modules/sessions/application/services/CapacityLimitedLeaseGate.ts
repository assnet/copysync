import { acquireLeaseResult, type ISessionLeaseGate, type LeaseAcquireResult } from '../../domain/contracts/ISessionLeaseRepository';
import { logger } from '../../../../shared/logger/logger';

export type CapacityGateLogger = Pick<typeof logger, 'warn'>;

/** Tempo máximo que uma reserva de abertura bem-sucedida segura a vaga até a sessão entrar na contagem. */
export const CAPACITY_RESERVATION_TTL_MS = 15_000;

/**
 * Janela em que uma sessão vista aqui com login em andamento reabre sem passar pelo teto: o
 * Baileys reinicia o socket logo depois do QR lido (`restartRequired`), já com credencial salva;
 * negar essa reabertura derrubaria o login recém-feito.
 */
export const LOGIN_RESTART_GRACE_MS = 60_000;

/** O que o gate lê do processo (o controle de socket das engines). */
export interface SessionCapacitySource {
  /** Sockets abertos ou abrindo (lease/renovação). */
  listLocal(): string[];
  /** Subconjunto com login concluído: só estes ocupam vaga. */
  listAuthenticated(): string[];
  /** Credencial salva que conecta sem QR/código (reabertura reserva vaga). */
  hasStoredCredentials(sessionId: string): Promise<boolean>;
}

export interface SessionCapacityLimits {
  /** `WORKER_MAX_SESSIONS`: sessões com login concluído. */
  maxSessions: number;
  /** `WORKER_MAX_PENDING_LOGINS`: logins em andamento (QR/código sem leitura). */
  maxPendingLogins: number;
}

/** Ocupação do processo: `sessions` (login concluído + reservas) e `pendingLogins` (QR/código). */
export interface SessionOccupancy {
  sessions: number;
  pendingLogins: number;
}

type SlotKind = 'session' | 'login';
interface Reservation {
  kind: SlotKind;
  timer: ReturnType<typeof setTimeout> | null;
}
type Slot = SlotKind | 'pass' | 'denied';

/**
 * Teto de sessões no gate do lease (ADOPT-06, T24). Decora o gate real (`AcquireSessionLeaseUseCase`).
 *
 * - Sessão já local (inclui socket abrindo) ou já reservada sempre repassa.
 * - Com credencial salva (reabertura/adoção): reserva vaga de sessão; `sessions >= maxSessions` nega.
 * - Sem credencial (QR/código/senha): não consome vaga; teto próprio `maxPendingLogins` nega.
 * - Login em andamento visto aqui há pouco que volta com credencial (reinício pós-QR) repassa mesmo
 *   com o teto cheio: logins concluídos podem exceder o teto; ticker e `session-open` só param de adotar.
 *
 * A reserva é síncrona depois da checagem de credencial (T22): aberturas simultâneas não passam
 * todas. Sai na hora em falha/negação; em sucesso, quando a sessão entra na contagem (autenticada
 * para `session`, local para `login`) ou após `reservationTtlMs`. `false` cai no 503 da rota (D3).
 */
export class CapacityLimitedLeaseGate implements ISessionLeaseGate {
  private readonly reserved = new Map<string, Reservation>();
  /** Última vez (ms) que a sessão foi vista local sem login concluído. */
  private readonly pendingSeenAt = new Map<string, number>();

  constructor(
    private readonly inner: ISessionLeaseGate,
    private readonly source: SessionCapacitySource,
    private readonly limits: SessionCapacityLimits,
    private readonly log: CapacityGateLogger = logger.child({ module: 'CapacityLimitedLeaseGate' }),
    private readonly reservationTtlMs = CAPACITY_RESERVATION_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async acquire(sessionId: string): Promise<boolean> {
    const slot = await this.reserve(sessionId);
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
    const slot = await this.reserve(sessionId);
    if (slot === 'denied') return 'held';
    const result = await acquireLeaseResult(this.inner, sessionId);
    this.settle(slot, sessionId, result === 'acquired');
    return result;
  }

  /** Ocupação atual (heartbeat, ticker, `session-open`). */
  occupancy(): SessionOccupancy {
    return this.count(this.snapshot());
  }

  private count({ local, auth }: Snapshot): SessionOccupancy {
    let sessions = auth.size;
    let pendingLogins = 0;
    for (const id of local) if (!auth.has(id) && this.reserved.get(id)?.kind !== 'session') pendingLogins += 1;
    for (const [id, r] of this.reserved) {
      if (r.kind === 'session' && !auth.has(id)) sessions += 1;
      if (r.kind === 'login' && !local.has(id)) pendingLogins += 1;
    }
    return { sessions, pendingLogins };
  }

  /** Decide e reserva: só a checagem de credencial é assíncrona; dali em diante é síncrono. */
  private async reserve(sessionId: string): Promise<Slot> {
    if (this.isLocalOrReserved(this.snapshot(), sessionId)) return 'pass';
    let withCredentials: boolean;
    try {
      withCredentials = await this.source.hasStoredCredentials(sessionId);
    } catch (err) {
      // Sem saber, conta como sessão (lado seguro do teto); o acquire real decide o resto.
      this.log.warn({ err, sessionId }, 'falha ao checar credencial salva; conta como sessão');
      withCredentials = true;
    }
    const snap = this.snapshot();
    if (this.isLocalOrReserved(snap, sessionId)) return 'pass';
    if (withCredentials && this.pendingSeenAt.has(sessionId)) return 'pass';
    const occupancy = this.count(snap);
    if (withCredentials) {
      if (occupancy.sessions >= this.limits.maxSessions) {
        this.log.warn({ sessionId, active: occupancy.sessions, max: this.limits.maxSessions }, 'teto de sessões atingido; lease negado');
        return 'denied';
      }
      return this.hold(sessionId, 'session');
    }
    if (occupancy.pendingLogins >= this.limits.maxPendingLogins) {
      this.log.warn(
        { sessionId, pendingLogins: occupancy.pendingLogins, max: this.limits.maxPendingLogins },
        'teto de logins pendentes atingido; lease negado',
      );
      return 'denied';
    }
    return this.hold(sessionId, 'login');
  }

  private isLocalOrReserved({ local }: Snapshot, sessionId: string): boolean {
    return local.has(sessionId) || this.reserved.has(sessionId);
  }

  private hold(sessionId: string, kind: SlotKind): SlotKind {
    this.reserved.set(sessionId, { kind, timer: null });
    return kind;
  }

  private settle(slot: Exclude<Slot, 'denied'>, sessionId: string, ok: boolean): void {
    if (slot === 'pass' || this.reserved.get(sessionId)?.kind !== slot) return;
    if (!ok) return this.freeSlot(sessionId);
    const { local, auth } = this.snapshot();
    if ((slot === 'session' && auth.has(sessionId)) || (slot === 'login' && local.has(sessionId))) {
      return this.freeSlot(sessionId);
    }
    const timer = setTimeout(() => this.reserved.delete(sessionId), this.reservationTtlMs);
    timer.unref?.();
    this.reserved.set(sessionId, { kind: slot, timer });
  }

  /**
   * Lê as listas e faz a manutenção: reserva que já entrou na contagem sai (não conta duas vezes),
   * login em andamento renova a marca de "visto" e marca vencida sai.
   */
  private snapshot(): Snapshot {
    const local = new Set(this.source.listLocal());
    const auth = new Set(this.source.listAuthenticated());
    for (const [id, r] of this.reserved) {
      if ((r.kind === 'session' && auth.has(id)) || (r.kind === 'login' && local.has(id))) this.freeSlot(id);
    }
    const now = this.now();
    for (const id of local) {
      // Reabertura com credencial (reserva de sessão) abrindo não é login em andamento.
      if (!auth.has(id) && this.reserved.get(id)?.kind !== 'session') this.pendingSeenAt.set(id, now);
    }
    for (const [id, at] of this.pendingSeenAt) if (now - at > LOGIN_RESTART_GRACE_MS) this.pendingSeenAt.delete(id);
    return { local, auth };
  }

  private freeSlot(sessionId: string): void {
    const timer = this.reserved.get(sessionId)?.timer;
    if (timer) clearTimeout(timer);
    this.reserved.delete(sessionId);
  }
}

interface Snapshot {
  local: Set<string>;
  auth: Set<string>;
}
