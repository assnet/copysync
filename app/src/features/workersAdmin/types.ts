/** Contrato de `GET /admin/workers` (ADOPT-12). Dado de plataforma: sem tenant nem dado de cliente. */
export interface WorkerOccupancy {
  workerId: string;
  role: string;
  /** Sessões abertas ou abrindo neste worker. */
  sessions: number;
  /** Teto do worker (`WORKER_MAX_SESSIONS`). */
  maxSessions: number;
  rssMb: number;
  /** Último batimento (ISO, relógio do servidor). */
  seenAt: string;
}

export interface WorkerOccupancyTotals {
  workers: number;
  sessions: number;
  maxSessions: number;
}

export interface WorkerOccupancyList {
  workers: WorkerOccupancy[];
  totals: WorkerOccupancyTotals;
  /** Sessões com pedido vivo e sem dono vivo. */
  awaiting: number;
}
