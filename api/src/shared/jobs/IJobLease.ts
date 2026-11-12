/**
 * Lease de job em tabela (`job_leases`): garante 1 processo por vez e serve de trava de
 * frequência externa (nada de "última execução" só em memória — docs/arquitetura-escala.md).
 */
export interface IJobLease {
  /** Adquire se livre ou vencido; `until` é o novo vencimento. */
  tryAcquire(name: string, ownerId: string, until: Date, now: Date): Promise<boolean>;
  /** Libera só se ainda é o dono. */
  release(name: string, ownerId: string): Promise<void>;
}

/**
 * Limpeza de leases por processo (nome `<job>:<workerId>`): o id muda a cada boot, então o
 * lease de processo que morreu sem liberar ficaria para sempre. Apaga só os vencidos antes de `expiredBefore`.
 */
export interface IJobLeaseSweep {
  /** Apaga leases cujo nome começa com `prefix` e `expiresAt < expiredBefore`; devolve quantos. */
  deleteExpiredByPrefix(prefix: string, expiredBefore: Date): Promise<number>;
}
