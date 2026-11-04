import { currentWorkerId } from '../../../../shared/config/workerIdentity';
import type { ISessionLeaseGate, ISessionLeaseRepository } from '../../domain/contracts/ISessionLeaseRepository';
import type { ISessionSocketControl } from '../../../messaging/domain/contracts/ISessionSocketControl';
import { PrismaSessionLeaseRepository } from '../repositories/PrismaSessionLeaseRepository';
import { SessionLeaseLedger } from '../../application/services/SessionLeaseLedger';
import { SessionLeaseKeeper } from '../../application/services/SessionLeaseKeeper';
import { AcquireSessionLeaseUseCase } from '../../application/use-cases/AcquireSessionLeaseUseCase';
import { RenewSessionLeaseUseCase } from '../../application/use-cases/RenewSessionLeaseUseCase';
import { ReleaseSessionLeaseUseCase } from '../../application/use-cases/ReleaseSessionLeaseUseCase';

export interface SessionLeaseContainer {
  workerId: string;
  repo: ISessionLeaseRepository;
  ledger: SessionLeaseLedger;
  acquire: AcquireSessionLeaseUseCase;
  renew: RenewSessionLeaseUseCase;
  release: ReleaseSessionLeaseUseCase;
  /** Porta das engines: `acquire` antes de abrir e `release` se a abertura falhar depois dele. */
  gate: ISessionLeaseGate;
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
export function buildSessionLeaseContainer(
  repo: ISessionLeaseRepository,
  workerId: string,
): SessionLeaseContainer {
  const ledger = new SessionLeaseLedger();
  let bound: ISessionSocketControl | undefined;
  const sockets: ISessionSocketControl = {
    abortSession: async (id) => bound?.abortSession(id),
    suspendSession: async (id) => bound?.suspendSession(id),
    resumeSession: async (id) => (await bound?.resumeSession(id)) ?? false,
    closeAllSockets: async () => bound?.closeAllSockets(),
    listLocalSessionIds: () => bound?.listLocalSessionIds() ?? [],
  };
  const acquire = new AcquireSessionLeaseUseCase(repo, ledger, workerId);
  const renew = new RenewSessionLeaseUseCase(repo, ledger, sockets, acquire, workerId);
  const release = new ReleaseSessionLeaseUseCase(repo, ledger, workerId);
  return {
    workerId,
    repo,
    ledger,
    acquire,
    renew,
    release,
    gate: {
      acquire: (id) => acquire.acquire(id),
      release: (id) => release.execute(id),
    },
    keeper: new SessionLeaseKeeper(renew),
    bindSocketControl(next) {
      bound = next;
    },
  };
}

let instance: SessionLeaseContainer | undefined;

/** Singleton preguiçoso do processo; o `workerId` vem de `currentWorkerId()` (T2). */
export function sessionLeaseContainer(): SessionLeaseContainer {
  instance ??= buildSessionLeaseContainer(new PrismaSessionLeaseRepository(), currentWorkerId());
  return instance;
}
