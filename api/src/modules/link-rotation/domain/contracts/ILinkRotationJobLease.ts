/**
 * Lease de job em tabela (`job_leases`): garante 1 processo por vez e serve de trava de
 * frequência externa (nada de "última execução" só em memória — docs/arquitetura-escala.md).
 */
export interface ILinkRotationJobLease {
  /** Adquire se livre ou vencido; `until` é o novo vencimento. */
  tryAcquire(name: string, ownerId: string, until: Date, now: Date): Promise<boolean>;
  /** Libera só se ainda é o dono. */
  release(name: string, ownerId: string): Promise<void>;
}
