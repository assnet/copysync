import { prisma } from '../../../../shared/database/prisma.client';
import { workerAdoptionConfig, type WorkerAdoptionConfig } from '../../../../shared/config/workerAdoption';
import { currentRole } from '../../../../shared/config/processRole';
import type { IJobLease } from '../../../../shared/jobs/IJobLease';
import { PrismaJobLease } from '../../../../shared/jobs/PrismaJobLease';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import { localEngine } from '../../../messaging/infrastructure/localEngineContainer';
import type { ISessionAdoptionRepository } from '../../domain/contracts/ISessionAdoptionRepository';
import type { IWorkerHeartbeatRepository } from '../../domain/contracts/IWorkerHeartbeatRepository';
import { PrismaSessionAdoptionRepository } from '../repositories/PrismaSessionAdoptionRepository';
import { PrismaWorkerHeartbeatRepository } from '../repositories/PrismaWorkerHeartbeatRepository';
import { AdoptNextSessionUseCase } from '../../application/use-cases/AdoptNextSessionUseCase';
import { SessionAdoptionTicker } from '../../application/services/SessionAdoptionTicker';
import { WorkerHeartbeatJob } from '../jobs/WorkerHeartbeatJob';
import { WorkerCapacityAlertJob } from '../jobs/WorkerCapacityAlertJob';
import { registerSessionAdoptionResetListener } from '../listeners/SessionAdoptionResetListener';
import { sessionLeaseContainer, type SessionLeaseContainer } from './sessionLeaseContainer';

export interface SessionAdoptionContainer {
  config: WorkerAdoptionConfig;
  adoption: ISessionAdoptionRepository;
  heartbeats: IWorkerHeartbeatRepository;
  /** Ticker de adoção (ADOPT-07), criado parado. */
  ticker: SessionAdoptionTicker;
  /** Batimento em `worker_heartbeats` (ADOPT-10), criado parado; `stop()` apaga a linha. */
  heartbeat: WorkerHeartbeatJob;
  /** Alerta de capacidade sob `JobLease` (ADOPT-11), criado parado. */
  capacityAlert: WorkerCapacityAlertJob;
  /** Remove o listener de `SESSION_CONNECTED` que zera o backoff (ADOPT-04). */
  dispose(): void;
}

export interface SessionAdoptionDeps {
  config: WorkerAdoptionConfig;
  lease: Pick<SessionLeaseContainer, 'workerId' | 'listLocal'>;
  /** Papel do processo (`worker`/`all`), gravado no heartbeat. */
  role: string;
  adoption: ISessionAdoptionRepository;
  heartbeats: IWorkerHeartbeatRepository;
  jobLease: IJobLease;
  audit: IAuditLogRepository;
  engine: Pick<IMessagingEngine, 'reconnectSession'>;
  registerReset?: (repo: Pick<ISessionAdoptionRepository, 'resetFailures'>) => () => void;
}

/**
 * Composição da adoção por capacidade (ADOPT-01/06). Ticker e jobs nascem parados: `server.ts`
 * (T15) decide quando ligar. O teto do gate mora no `sessionLeaseContainer` (mesma flag).
 */
export function buildSessionAdoptionContainer(deps: SessionAdoptionDeps): SessionAdoptionContainer {
  const { config, lease, adoption, heartbeats } = deps;
  const tick = new AdoptNextSessionUseCase({
    adoption,
    engine: deps.engine,
    audit: deps.audit,
    listLocal: lease.listLocal,
    workerId: lease.workerId,
    shard: config.shard,
    maxSessions: config.maxSessions,
  });
  const unregister = (deps.registerReset ?? registerSessionAdoptionResetListener)(adoption);
  return {
    config,
    adoption,
    heartbeats,
    ticker: new SessionAdoptionTicker(tick),
    heartbeat: new WorkerHeartbeatJob({
      heartbeats,
      workerId: lease.workerId,
      role: deps.role,
      maxSessions: config.maxSessions,
      listLocal: lease.listLocal,
    }),
    // D5: sem template de e-mail na central, sem `notifier` (alerta só no log).
    capacityAlert: new WorkerCapacityAlertJob({ lease: deps.jobLease, heartbeats, adoption }),
    dispose: unregister,
  };
}

let instance: SessionAdoptionContainer | null | undefined;

/**
 * Singleton preguiçoso do processo. Flag `WORKER_ADOPTION_ENABLED` desligada → `null` sem montar
 * nada (nem repositório, nem listener, nem timer). Só chamar em `worker`/`all`.
 */
export function sessionAdoptionContainer(): SessionAdoptionContainer | null {
  if (instance !== undefined) return instance;
  const config = workerAdoptionConfig();
  if (!config.enabled) {
    instance = null;
    return instance;
  }
  instance = buildSessionAdoptionContainer({
    config,
    lease: sessionLeaseContainer(),
    role: currentRole(),
    adoption: new PrismaSessionAdoptionRepository(),
    heartbeats: new PrismaWorkerHeartbeatRepository(),
    jobLease: new PrismaJobLease(prisma),
    audit: new PrismaAuditLogRepository(),
    // Lazy: a engine local só sobe no 1º tick que adota.
    engine: { reconnectSession: (input) => localEngine().reconnectSession(input) },
  });
  return instance;
}
