import { currentWorkerId } from '../../../../shared/config/workerIdentity';
import { workerAdoptionConfig, workerScalingEnvDefaults } from '../../../../shared/config/workerAdoption';
import { prisma } from '../../../../shared/database/prisma.client';
import type { WorkerScalingSettings } from '../../domain/services/workerScalingSettings';
import { PrismaWorkerScalingSettingsRepository } from '../repositories/PrismaWorkerScalingSettingsRepository';
import { RefreshingWorkerScalingSettingsProvider } from './RefreshingWorkerScalingSettingsProvider';
import type { ISessionLeaseGate, ISessionLeaseRepository } from '../../domain/contracts/ISessionLeaseRepository';
import type { ISessionSocketControl } from '../../../messaging/domain/contracts/ISessionSocketControl';
import { PrismaSessionLeaseRepository } from '../repositories/PrismaSessionLeaseRepository';
import { SessionLeaseLedger } from '../../application/services/SessionLeaseLedger';
import { SessionLeaseKeeper } from '../../application/services/SessionLeaseKeeper';
import { CapacityLimitedLeaseGate, type SessionOccupancy } from '../../application/services/CapacityLimitedLeaseGate';
import { AcquireSessionLeaseUseCase } from '../../application/use-cases/AcquireSessionLeaseUseCase';
import { RenewSessionLeaseUseCase, type ResumeGiveUpStatus } from '../../application/use-cases/RenewSessionLeaseUseCase';
import { PrismaSessionRepository } from '../repositories/PrismaSessionRepository';
import { ReleaseSessionLeaseUseCase } from '../../application/use-cases/ReleaseSessionLeaseUseCase';
import {
  GetWorkerScalingSettingsUseCase,
  workerScalingEnforcedCheck,
  type WorkerScalingSettingsViewDeps,
} from '../../application/use-cases/GetWorkerScalingSettingsUseCase';
import { UpdateWorkerScalingSettingsUseCase } from '../../application/use-cases/UpdateWorkerScalingSettingsUseCase';
import { PrismaWorkerHeartbeatRepository } from '../repositories/PrismaWorkerHeartbeatRepository';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { env } from '../../../../shared/config/env';
import { GetWorkerCapacityUseCase } from '../../application/use-cases/GetWorkerCapacityUseCase';
import { PrismaWorkerCapacityReader } from '../repositories/PrismaWorkerCapacityReader';
import { PrismaOpsMetricsSampleRepository } from '../../../metrics/infrastructure/repositories/PrismaOpsMetricsSampleRepository';
import { connectedSessionsNow } from '../../application/use-cases/GetWorkerCapacityUseCase';
import { ScaleWorkersUseCase } from '../../application/use-cases/ScaleWorkersUseCase';
import { GetWorkerScaleStateUseCase } from '../../application/use-cases/GetWorkerScaleStateUseCase';
import { RequestWorkerScaleUseCase } from '../../application/use-cases/RequestWorkerScaleUseCase';
import { ListWorkerScaleEventsUseCase } from '../../application/use-cases/ListWorkerScaleEventsUseCase';
import { WorkerScalerStateCache } from '../../application/services/WorkerScalerStateCache';
import { PrismaWorkerScaleEventRepository } from '../repositories/PrismaWorkerScaleEventRepository';
import { RENDER_SERVICE_ID_PATTERN, workerScaler } from '../scaler/workerScaler';

export interface SessionLeaseContainer {
  workerId: string;
  repo: ISessionLeaseRepository;
  ledger: SessionLeaseLedger;
  acquire: AcquireSessionLeaseUseCase;
  renew: RenewSessionLeaseUseCase;
  release: ReleaseSessionLeaseUseCase;
  /**
   * Gate efetivo das engines: `acquire` antes de abrir e `release` se a abertura falhar depois
   * dele. Com teto (adoção ligada, ADOPT-06) nega sessão nova com o processo cheio.
   */
  gate: ISessionLeaseGate;
  /** Sessões com socket local (aberto ou abrindo); vazio antes de `bindSocketControl`. */
  listLocal(): string[];
  /**
   * Ocupação para o teto (T24): `sessions` = login concluído + reservas; `pendingLogins` = QR/código
   * sem leitura. Sem teto (flag desligada): `sessions` = sockets locais e `pendingLogins` = 0.
   */
  occupancy(): SessionOccupancy;
  /** Keeper criado parado: `server.ts` chama `start()` depois do boot das sessões. */
  keeper: SessionLeaseKeeper;
  /** Liga o controle de socket (o roteador de engines) usado pela renovação. */
  bindSocketControl(sockets: ISessionSocketControl): void;
}

/**
 * Composição do lease de sessão (LEASE-03/04/05). Única instância por processo: o razão
 * é compartilhado entre o gate das engines, a renovação e o release. Importar não toca
 * banco. Antes de `bindSocketControl` a renovação vê zero sockets locais (não faz nada).
 */
export interface SessionLeaseCapacity {
  /** Teto de sessões com login concluído (`maxSessionsPerWorker` da configuração de escala). */
  maxSessions: number;
  /** Teto de logins em andamento (`maxPendingLoginsPerWorker` da configuração de escala). */
  maxPendingLogins: number;
}

/** Teto do gate a partir da configuração de escala efetiva (WSCALE-04). */
export function capacityFromSettings(settings: WorkerScalingSettings): SessionLeaseCapacity {
  return { maxSessions: settings.maxSessionsPerWorker, maxPendingLogins: settings.maxPendingLoginsPerWorker };
}

/** Sem porta de status (testes): a desistência da retomada só loga. */
const NO_STATUS: ResumeGiveUpStatus = { markDisconnectedIfNoLiveLease: async () => false };

export function buildSessionLeaseContainer(
  repo: ISessionLeaseRepository,
  workerId: string,
  /** Teto lido a cada `acquire` (WSCALE-04); ausente = sem teto (adoção desligada). */
  capacity?: () => SessionLeaseCapacity,
  status: ResumeGiveUpStatus = NO_STATUS,
): SessionLeaseContainer {
  const ledger = new SessionLeaseLedger();
  let bound: ISessionSocketControl | undefined;
  const sockets: ISessionSocketControl = {
    abortSession: async (id, options) => bound?.abortSession(id, options),
    suspendSession: async (id) => bound?.suspendSession(id),
    resumeSession: async (id) => (bound ? bound.resumeSession(id) : 'gone'),
    forgetSuspension: async (id) => (bound ? bound.forgetSuspension(id) : null),
    adoptSession: async (id, tenantId) => (bound ? bound.adoptSession(id, tenantId) : 'error'),
    closeAllSockets: async () => bound?.closeAllSockets(),
    listLocalSessionIds: () => bound?.listLocalSessionIds() ?? [],
    listAuthenticatedSessionIds: () => bound?.listAuthenticatedSessionIds() ?? [],
    hasStoredCredentials: async (id) => (bound ? bound.hasStoredCredentials(id) : false),
  };
  const acquire = new AcquireSessionLeaseUseCase(repo, ledger, workerId);
  const renew = new RenewSessionLeaseUseCase(repo, ledger, sockets, status, workerId);
  const release = new ReleaseSessionLeaseUseCase(repo, ledger, workerId);
  const listLocal = (): string[] => sockets.listLocalSessionIds();
  const baseGate: ISessionLeaseGate = {
    acquire: (id) => acquire.acquire(id),
    acquireResult: (id) => acquire.acquireResult(id),
    release: (id) => release.execute(id),
  };
  // Sem teto (flag desligada) o gate é exatamente o de antes (E3).
  const capped = capacity
    ? new CapacityLimitedLeaseGate(
      baseGate,
      {
        listLocal,
        listAuthenticated: () => sockets.listAuthenticatedSessionIds(),
        hasStoredCredentials: (id) => sockets.hasStoredCredentials(id),
      },
      capacity,
    )
    : undefined;
  const gate = capped ? withRelease(capped, baseGate) : baseGate;
  const occupancy = (): SessionOccupancy => capped?.occupancy() ?? { sessions: listLocal().length, pendingLogins: 0 };
  return {
    workerId,
    repo,
    ledger,
    acquire,
    renew,
    release,
    gate,
    listLocal,
    occupancy,
    keeper: new SessionLeaseKeeper(renew),
    bindSocketControl(next) {
      bound = next;
    },
  };
}

/** O decorador de teto só decide o `acquire`; o `release` segue o do gate base. */
function withRelease(capped: CapacityLimitedLeaseGate, base: ISessionLeaseGate): ISessionLeaseGate {
  return { acquire: (id) => capped.acquire(id), acquireResult: (id) => capped.acquireResult(id), release: base.release };
}

let instance: SessionLeaseContainer | undefined;
let settingsProvider: RefreshingWorkerScalingSettingsProvider | undefined;

/**
 * Configuração de escala do processo (WSCALE-03), singleton. Nasce com o valor da env, sem I/O:
 * `server.ts` faz `refresh()` + `start()` depois de conectar no banco e `stop()` no shutdown.
 * Existe em todo papel (as rotas leem e o salvamento chama `refresh()`), com ou sem adoção.
 * Consumidores leem `current()` a cada uso, nunca guardam o número.
 */
export function workerScalingSettingsProvider(): RefreshingWorkerScalingSettingsProvider {
  settingsProvider ??= new RefreshingWorkerScalingSettingsProvider({
    repository: new PrismaWorkerScalingSettingsRepository(prisma),
    envDefaults: workerScalingEnvDefaults(),
  });
  return settingsProvider;
}

let getSettingsUseCase: GetWorkerScalingSettingsUseCase | undefined;
let updateSettingsUseCase: UpdateWorkerScalingSettingsUseCase | undefined;

/** `enforced` da tela: adoção ligada aqui ou batimento vivo de algum worker (com `http` separado). */
function workerScalingSettingsViewDeps(): WorkerScalingSettingsViewDeps {
  return {
    envDefaults: workerScalingEnvDefaults(),
    isEnforced: workerScalingEnforcedCheck(() => workerAdoptionConfig().enabled, new PrismaWorkerHeartbeatRepository()),
  };
}

/** Leitura da configuração de escala para o super admin (singleton preguiçoso; import não toca banco). */
export function getWorkerScalingSettingsUseCase(): GetWorkerScalingSettingsUseCase {
  getSettingsUseCase ??= new GetWorkerScalingSettingsUseCase(
    new PrismaWorkerScalingSettingsRepository(prisma),
    workerScalingSettingsViewDeps(),
  );
  return getSettingsUseCase;
}

/** Gravação auditada da configuração de escala; aplica no processo pelo mesmo provider. */
export function updateWorkerScalingSettingsUseCase(): UpdateWorkerScalingSettingsUseCase {
  updateSettingsUseCase ??= new UpdateWorkerScalingSettingsUseCase(
    new PrismaWorkerScalingSettingsRepository(prisma),
    new PrismaAuditLogRepository(),
    workerScalingSettingsProvider(),
    workerScalingSettingsViewDeps(),
  );
  return updateSettingsUseCase;
}

let capacityUseCase: GetWorkerCapacityUseCase | undefined;

/**
 * Capacidade por plano e do cluster (WSCALE-09), singleton preguiçoso. Só tabelas locais; os IDs
 * `srv-` de `RENDER_RESOURCE_IDS` só decidem se a memória é atribuível (mais de um → `null`), salvo com
 * `WORKER_SCALER_SERVICE_ID` válido: aí vale só esse serviço e as instâncias dele.
 */
export function getWorkerCapacityUseCase(): GetWorkerCapacityUseCase {
  capacityUseCase ??= new GetWorkerCapacityUseCase({
    reader: new PrismaWorkerCapacityReader(prisma),
    samples: new PrismaOpsMetricsSampleRepository(prisma),
    settings: () => getWorkerScalingSettingsUseCase().execute(),
    renderServiceIds: (env.RENDER_RESOURCE_IDS ?? '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('srv-')),
    scalerServiceId: scalerServiceIdForMemory(),
  });
  return capacityUseCase;
}

/** `WORKER_SCALER_SERVICE_ID` no formato `srv-...`; fora dele (ou ausente) o filtro antigo vale. */
function scalerServiceIdForMemory(): string | null {
  const id = env.WORKER_SCALER_SERVICE_ID?.trim();
  return id && RENDER_SERVICE_ID_PATTERN.test(id) ? id : null;
}

let scaleStateCache: WorkerScalerStateCache | undefined;
let scaleStateUseCase: GetWorkerScaleStateUseCase | undefined;
let requestScaleUseCase: RequestWorkerScaleUseCase | undefined;
let listScaleEventsUseCase: ListWorkerScaleEventsUseCase | undefined;

/** Cache do estado do escalador do processo (30 s), compartilhado entre o `GET` e o `POST`. */
export function workerScalerStateCache(): WorkerScalerStateCache {
  scaleStateCache ??= new WorkerScalerStateCache(workerScaler());
  return scaleStateCache;
}

/** Estado da aba Escala (WSCALE-14), singleton preguiçoso. */
export function getWorkerScaleStateUseCase(): GetWorkerScaleStateUseCase {
  scaleStateUseCase ??= new GetWorkerScaleStateUseCase({
    state: workerScalerStateCache(),
    settings: workerScalingSettingsProvider(),
    events: new PrismaWorkerScaleEventRepository(prisma),
    isEnforced: workerScalingSettingsViewDeps().isEnforced,
  });
  return scaleStateUseCase;
}

/**
 * Pedido manual de escala (WSCALE-12): `getState` ao vivo dentro do `ScaleWorkersUseCase`, adoção
 * lida a cada pedido e conectadas pela última amostra `sessions_connected`.
 */
export function requestWorkerScaleUseCase(): RequestWorkerScaleUseCase {
  if (!requestScaleUseCase) {
    const samples = new PrismaOpsMetricsSampleRepository(prisma);
    const reader = new PrismaWorkerCapacityReader(prisma);
    requestScaleUseCase = new RequestWorkerScaleUseCase({
      scale: new ScaleWorkersUseCase({
        events: new PrismaWorkerScaleEventRepository(prisma),
        scaler: workerScaler(),
        settings: workerScalingSettingsProvider(),
        audit: new PrismaAuditLogRepository(),
        isAdoptionEnabled: () => workerAdoptionConfig().enabled,
      }),
      connectedSessions: () => connectedSessionsNow({ samples, reader }),
      state: workerScalerStateCache(),
    });
  }
  return requestScaleUseCase;
}

/** Histórico de escala paginado (WSCALE-13). */
export function listWorkerScaleEventsUseCase(): ListWorkerScaleEventsUseCase {
  listScaleEventsUseCase ??= new ListWorkerScaleEventsUseCase(new PrismaWorkerScaleEventRepository(prisma));
  return listScaleEventsUseCase;
}

/**
 * Singleton preguiçoso do processo; o `workerId` vem de `currentWorkerId()` (T2). Teto no gate
 * só com `WORKER_ADOPTION_ENABLED` (ADOPT-06), lido do provider a cada uso; desligada, nada muda
 * em relação à E3.
 */
export function sessionLeaseContainer(): SessionLeaseContainer {
  if (!instance) {
    const settings = workerScalingSettingsProvider();
    instance = buildSessionLeaseContainer(
      new PrismaSessionLeaseRepository(),
      currentWorkerId(),
      workerAdoptionConfig().enabled ? () => capacityFromSettings(settings.current().value) : undefined,
      new PrismaSessionRepository(),
    );
  }
  return instance;
}
