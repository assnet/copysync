/**
 * Processos donos de lease vivo (docs/arquitetura-escala.md §3.1): visão de plataforma para o
 * super-admin quando a adoção por capacidade está desligada (sem heartbeat). Só leitura, sem tenant:
 * o lease é do processo, não do tenant.
 */
export interface SessionLeaseHolder {
  workerId: string;
  /** Sessões com lease não vencido deste processo (socket aberto ou abrindo). */
  sessions: number;
  /** Maior validade de lease do processo (relógio do banco): a última renovação + TTL. */
  leaseUntil: Date;
}

export interface ISessionLeaseHolderRepository {
  /** Leases não vencidos agrupados por processo, ordenados por `workerId`. */
  listLiveHolders(): Promise<SessionLeaseHolder[]>;
}
