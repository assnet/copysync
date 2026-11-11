import { currentWorkerId } from '../../../../shared/config/workerIdentity';
import { workerAdoptionConfig } from '../../../../shared/config/workerAdoption';
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
  /** Teto de sessões com login concluído (`WORKER_MAX_SESSIONS`). */
  maxSessions: number;
  /** Teto de logins em andamento (`WORKER_MAX_PENDING_LOGINS`). */
  maxPendingLogins: number;
}

/** Sem porta de status (testes): a desistência da retomada só loga. */
const NO_STATUS: ResumeGiveUpStatus = { markDisconnectedIfNoLiveLease: async () => false };

export function buildSessionLeaseContainer(
  repo: ISessionLeaseRepository,
  workerId: string,
  capacity?: SessionLeaseCapacity,
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
      () => capacity,
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

/**
 * Singleton preguiçoso do processo; o `workerId` vem de `currentWorkerId()` (T2). Teto no gate
 * só com `WORKER_ADOPTION_ENABLED` (ADOPT-06); desligada, nada muda em relação à E3.
 */
export function sessionLeaseContainer(): SessionLeaseContainer {
  if (!instance) {
    const adoption = workerAdoptionConfig();
    instance = buildSessionLeaseContainer(
      new PrismaSessionLeaseRepository(),
      currentWorkerId(),
      adoption.enabled ? { maxSessions: adoption.maxSessions, maxPendingLogins: adoption.maxPendingLogins } : undefined,
      new PrismaSessionRepository(),
    );
  }
  return instance;
}
