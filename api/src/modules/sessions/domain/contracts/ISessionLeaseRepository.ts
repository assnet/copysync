/**
 * Lease de sessão (docs/arquitetura-escala.md §3.1): só o processo dono abre o socket.
 * Relógio é sempre o do banco (`now()`), nunca o do Node. Operações por `sessionId` + `workerId`:
 * o lease é do processo, não do tenant (o id da sessão já é único).
 */
export interface ISessionLeaseRepository {
  /** Adquire se o lease está livre, vencido ou já é deste worker (LEASE-03). Sessão apagada → `false`. */
  tryAcquire(sessionId: string, workerId: string, ttlMs: number): Promise<boolean>;
  /** Renova os ids ainda deste worker e não vencidos; devolve só os renovados (LEASE-04). */
  renew(sessionIds: readonly string[], workerId: string, ttlMs: number): Promise<string[]>;
  /** Solta o lease só se este worker for o dono (LEASE-05). */
  release(sessionId: string, workerId: string): Promise<void>;
  /**
   * Shutdown (LEASE-09, D1): solta todos os leases do worker e marca `DISCONNECTED` as ativas dele,
   * mantendo `connectRequestedAt`. Devolve quantas linhas foram soltas.
   */
  releaseAllOwned(workerId: string): Promise<number>;
  /**
   * Dono vivo (WROLE-05): `ownerWorkerId` se o lease não venceu no relógio do banco; vencido,
   * sem dono ou sessão inexistente → `null`. Só leitura; o HTTP usa para rotear ao worker.
   */
  findLiveOwner(sessionId: string): Promise<string | null>;
}

/** `held` = outro processo é dono (prova); `error` = banco falhou (sem prova, vale tentar de novo). */
export type LeaseAcquireResult = 'acquired' | 'held' | 'error';

/** Porta estreita que os adapters de engine recebem: `false` = outro processo é dono. */
export interface ISessionLeaseGate {
  acquire(sessionId: string): Promise<boolean>;
  /**
   * Mesmo acquire com o motivo da negativa (retomada pós-fence distingue outro dono de erro de
   * banco). Ausente: `acquire` booleano, `false` lido como `held`.
   */
  acquireResult?(sessionId: string): Promise<LeaseAcquireResult>;
  /**
   * Abertura que falhou depois do `acquire` (sem socket): solta o lease só se este worker for o
   * dono e tira do razão. Best-effort, nunca lança. Ausente (teste, boot sem lease): vence no TTL.
   */
  release?(sessionId: string): Promise<void>;
}

/** Acquire tipado de qualquer gate (com ou sem `acquireResult`); lançar conta como `error`. */
export async function acquireLeaseResult(gate: ISessionLeaseGate, sessionId: string): Promise<LeaseAcquireResult> {
  try {
    if (gate.acquireResult) return await gate.acquireResult(sessionId);
    return (await gate.acquire(sessionId)) ? 'acquired' : 'held';
  } catch {
    return 'error';
  }
}
