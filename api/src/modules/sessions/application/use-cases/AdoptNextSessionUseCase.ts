import type { ISessionAdoptionRepository } from '../../domain/contracts/ISessionAdoptionRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { hasCapacity } from '../../domain/services/sessionAdoptionPolicy';
import { LEASE_TTL_MS } from '../../domain/services/sessionLeasePolicy';
import { SessionLeaseHeldError } from '../../../../shared/errors/internal/SessionErrors';
import { logger } from '../../../../shared/logger/logger';

export type AdoptLogger = Pick<typeof logger, 'info' | 'warn'>;

/** Resultado de um tick: sem vaga, nada a adotar, adotada e reconectada, ou adotada com falha. */
export type AdoptTickResult = 'full' | 'none' | 'adopted' | 'failed';

export interface AdoptNextSessionDeps {
  adoption: ISessionAdoptionRepository;
  engine: Pick<IMessagingEngine, 'reconnectSession'>;
  audit: IAuditLogRepository;
  /** Sessões deste processo (inclui socket abrindo, F3 da E2). */
  listLocal: () => string[];
  workerId: string;
  shard: string | null;
  maxSessions: number;
  log?: AdoptLogger;
}

/**
 * Um tick da adoção por capacidade (ADOPT-05/07, D2): esgotadas viram `FAILED` com auditoria;
 * com vaga, adota **uma** órfã e reconecta pela origem `auto` (como o bootstrap). Falha da
 * reconexão só loga: a tentativa e o backoff já foram gravados por `adoptNext` (D1).
 */
export class AdoptNextSessionUseCase {
  private readonly log: AdoptLogger;

  constructor(private readonly deps: AdoptNextSessionDeps) {
    this.log = deps.log ?? logger.child({ module: 'AdoptNextSession' });
  }

  async execute(): Promise<AdoptTickResult> {
    await this.failExhausted();

    const { adoption, engine, listLocal, workerId, shard, maxSessions } = this.deps;
    if (!hasCapacity(listLocal().length, maxSessions)) return 'full';

    const adopted = await adoption.adoptNext(workerId, shard, LEASE_TTL_MS);
    if (!adopted) return 'none';

    try {
      await engine.reconnectSession({ sessionId: adopted.id, tenantId: adopted.tenantId });
      this.log.info({ sessionId: adopted.id, tenantId: adopted.tenantId }, 'sessão órfã adotada');
      return 'adopted';
    } catch (err) {
      const held = err instanceof SessionLeaseHeldError;
      this.log.warn(
        { err: held ? undefined : err, sessionId: adopted.id, tenantId: adopted.tenantId },
        held ? 'adoção negada pelo lease' : 'falha ao reconectar sessão adotada',
      );
      return 'failed';
    }
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
