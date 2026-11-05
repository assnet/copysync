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

export interface WorkerOccupancyList {
  workers: WorkerOccupancy[];
  totals: WorkerOccupancyTotals;
  /** Sessões com pedido vivo e sem dono vivo. */
  awaiting: number;
}
