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
}

/** Porta estreita que os adapters de engine recebem: `false` = outro processo é dono. */
export interface ISessionLeaseGate {
  acquire(sessionId: string): Promise<boolean>;
}
