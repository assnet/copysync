import type { AdoptedSessionRef, ISessionAdoptionRepository } from '../../domain/contracts/ISessionAdoptionRepository';
import type { ISessionSocketControl, SessionAdoptResult } from '../../../messaging/domain/contracts/ISessionSocketControl';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { hasCapacity } from '../../domain/services/sessionAdoptionPolicy';
import { LEASE_TTL_MS } from '../../domain/services/sessionLeasePolicy';
import { logger } from '../../../../shared/logger/logger';

export type AdoptLogger = Pick<typeof logger, 'info' | 'warn'>;

/**
 * Resultado de um tick: sem vaga, nada a adotar, adotada e aberta, devolvida (lease negado ou
 * teto: lease solto e tentativa desfeita), cancelada (abort/suspend/usuário/stop) ou falha.
 */
export type AdoptTickResult = 'full' | 'none' | 'adopted' | 'released' | 'cancelled' | 'failed';

export interface AdoptNextSessionDeps {
  adoption: ISessionAdoptionRepository;
  engine: Pick<ISessionSocketControl, 'adoptSession' | 'abortSession'>;
  audit: IAuditLogRepository;
  /** Vagas ocupadas neste processo: login concluído + reservas (T24; QR sem leitura não conta). */
  occupiedSessions: () => number;
  workerId: string;
  shard: string | null;
  /** Teto de sessões deste processo, lido a cada tick (configuração de escala, WSCALE-04). */
  maxSessions: () => number;
  log?: AdoptLogger;
}

/** Abertura em voo do tick, para `cancel()` soltar o tick sem esperar a engine. */
interface AdoptionInFlight {
  sessionId: string;
  stop: () => void;
}

/**
 * Um tick da adoção por capacidade (ADOPT-05/07, D2): esgotadas viram `FAILED` com auditoria;
 * com vaga, adota **uma** órfã e abre pela porta de adoção da engine (origem `auto`). Lease negado
 * ou teto (`held`) não é falha da sessão: solta o lease e desfaz o `+1`/backoff. Erro só loga: a
 * tentativa e o backoff já foram gravados por `adoptNext` (D1).
 */
export class AdoptNextSessionUseCase {
  private readonly log: AdoptLogger;
  private inFlight: AdoptionInFlight | undefined;
  private cancelRequested = false;

  constructor(private readonly deps: AdoptNextSessionDeps) {
    this.log = deps.log ?? logger.child({ module: 'AdoptNextSession' });
  }

  async execute(): Promise<AdoptTickResult> {
    this.cancelRequested = false;
    await this.failExhausted();

    const { adoption, occupiedSessions, workerId, shard, maxSessions } = this.deps;
    if (!hasCapacity(occupiedSessions(), maxSessions())) return 'full';

    const adopted = await adoption.adoptNext(workerId, shard, LEASE_TTL_MS);
    if (!adopted) return 'none';
    // Shutdown no meio do `adoptNext`: não abre; o lease sai no `releaseAllOwned` (ou no TTL)
    if (this.cancelRequested) return 'cancelled';

    const ctx = { sessionId: adopted.id, tenantId: adopted.tenantId };
    let result: SessionAdoptResult | 'stopped';
    try {
      result = await this.open(adopted);
    } catch (err) {
      this.log.warn({ err, ...ctx }, 'falha ao abrir sessão adotada');
      return 'failed';
    }
    switch (result) {
      case 'opened':
        this.log.info(ctx, 'sessão órfã adotada');
        return 'adopted';
      case 'held':
        await this.giveBack(adopted);
        return 'released';
      case 'cancelled':
      case 'stopped':
        this.log.info({ ...ctx, reason: result }, 'abertura da sessão adotada cancelada');
        return 'cancelled';
      default:
        this.log.warn(ctx, 'falha ao abrir sessão adotada');
        return 'failed';
    }
  }

  /**
   * Shutdown (ADOPT-14): solta o tick em curso sem esperar a abertura e pede à engine que a
   * cancele (`onlyAuto`: abertura do usuário em voo segue). Sem abertura em voo: só marca.
   */
  cancel(): void {
    this.cancelRequested = true;
    const flight = this.inFlight;
    if (!flight) return;
    flight.stop();
    this.deps.engine.abortSession(flight.sessionId, { onlyAuto: true }).catch((err) => {
      this.log.warn({ err, sessionId: flight.sessionId }, 'falha ao cancelar abertura da adoção');
    });
  }

  private async open(s: AdoptedSessionRef): Promise<SessionAdoptResult | 'stopped'> {
    let stop!: () => void;
    const stopped = new Promise<'stopped'>((resolve) => { stop = () => resolve('stopped'); });
    const op = this.deps.engine.adoptSession(s.id, s.tenantId);
    op.catch(() => undefined); // largada pelo stop: a rejeição tardia não fica sem tratamento
    this.inFlight = { sessionId: s.id, stop };
    try {
      return await Promise.race([op, stopped]);
    } finally {
      this.inFlight = undefined;
    }
  }

  /** `held`: outro dono ou teto (corrida com abertura local). Devolve a vaga e a tentativa. */
  private async giveBack(s: AdoptedSessionRef): Promise<void> {
    const full = !hasCapacity(this.deps.occupiedSessions(), this.deps.maxSessions());
    try {
      await this.deps.adoption.revertAdoptAttempt(s.id, this.deps.workerId);
    } catch (err) {
      this.log.warn({ err, sessionId: s.id, tenantId: s.tenantId }, 'falha ao devolver sessão adotada');
      return;
    }
    this.log.info(
      { sessionId: s.id, tenantId: s.tenantId, reason: full ? 'full' : 'held' },
      'adoção devolvida: lease negado; tentativa desfeita',
    );
  }

  private async failExhausted(): Promise<void> {
    let failed;
    try {
      failed = await this.deps.adoption.failExhausted();
    } catch (err) {
      this.log.warn({ err }, 'falha ao marcar sessões esgotadas');
      return;
    }
    for (const s of failed) {
      this.log.warn({ sessionId: s.id, tenantId: s.tenantId }, 'adoção esgotada; sessão marcada FAILED');
      try {
        // Sem ação própria no enum (exigiria migration): DISCONNECTED com o motivo no meta.
        await this.deps.audit.create({
          tenantId: s.tenantId,
          action: 'SESSION_DISCONNECTED',
          meta: { sessionId: s.id, status: 'FAILED', reason: 'ADOPTION_EXHAUSTED' },
        });
      } catch (err) {
        this.log.warn({ err, sessionId: s.id }, 'falha ao auditar sessão esgotada');
      }
    }
  }
}
