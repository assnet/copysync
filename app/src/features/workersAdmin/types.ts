/** Contrato de `GET /admin/workers` (ADOPT-12). Dado de plataforma: sem tenant nem dado de cliente. */
export interface WorkerOccupancy {
  workerId: string;
  role: string;
  /** Sessões com login concluído neste worker (as que ocupam vaga do teto). */
  sessions: number;
  /** Logins em andamento (QR Code/código sem leitura): não ocupam vaga. */
  pendingLogins: number;
  /** Teto do worker (`WORKER_MAX_SESSIONS`). */
  maxSessions: number;
  rssMb: number;
  /** Último batimento (ISO, relógio do servidor). */
  seenAt: string;
}

export interface WorkerOccupancyTotals {
  workers: number;
  sessions: number;
  pendingLogins: number;
  maxSessions: number;
}

/** Processo dono de lease vivo (adoção desligada): sem heartbeat nem teto. */
export interface LeaseProcess {
  workerId: string;
  /** Sessões com lease não vencido (socket aberto ou abrindo). */
  sessions: number;
  /** Maior validade de lease do processo (ISO, relógio do banco). */
  leaseUntil: string;
}

export interface WorkerOccupancyList {
  /** `WORKER_ADOPTION_ENABLED`. Ausente (API antiga) = ligada. */
  adoptionEnabled?: boolean;
  workers: WorkerOccupancy[];
  totals: WorkerOccupancyTotals;
  /** Sessões com pedido vivo e sem dono vivo. */
  awaiting: number;
  /** Só com adoção desligada: leases vivos agrupados por processo. */
  processes?: LeaseProcess[];
  /** Soma das sessões com lease vivo (adoção desligada). */
  leasedSessions?: number;
}
