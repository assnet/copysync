/**
 * Batimento dos processos que rodam sessões (`worker`/`all`), ADOPT-10/12. Dado de plataforma, sem
 * `tenantId`. Relógio é sempre o do banco (UTC), nunca o do Node.
 */
export interface WorkerHeartbeatInput {
  workerId: string;
  /** Papel do processo: `all` | `worker`. */
  role: string;
  /** Sessões com login concluído (+ reservas) neste processo: as que ocupam vaga (T24). */
  sessions: number;
  /** Logins em andamento (QR/código sem leitura): não ocupam vaga; teto `WORKER_MAX_PENDING_LOGINS`. */
  pendingLogins: number;
  /** Teto do processo (`WORKER_MAX_SESSIONS`). */
  maxSessions: number;
  /** Memória residente em MB. */
  rssMb: number;
}

export interface WorkerHeartbeat extends WorkerHeartbeatInput {
  /** Último batimento (horário do banco). */
  seenAt: Date;
}

export interface IWorkerHeartbeatRepository {
  /** Upsert com `seenAt = now()` do banco; apaga, best-effort, linhas mortas há mais de 1 dia. */
  beat(row: WorkerHeartbeatInput): Promise<void>;
  /** Workers com `seenAt` mais novo que `maxAgeMs` (ADOPT-02: vivo = < 90 s), por `workerId`. */
  listAlive(maxAgeMs: number): Promise<WorkerHeartbeat[]>;
  /** Apaga só a linha deste worker (shutdown). */
  remove(workerId: string): Promise<void>;
}
