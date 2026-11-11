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

/** Modo do escalador de réplicas (WSCALE-01). */
export type WorkerScalerMode = 'off' | 'manual' | 'auto';

/** Configuração de escala dos workers (WSCALE-01). Todos inteiros, salvo `alertOccupancyRatio`. */
export interface WorkerScalingSettings {
  maxSessionsPerWorker: number;
  maxPendingLoginsPerWorker: number;
  alertOccupancyRatio: number;
  awaitingAlertSeconds: number;
  scalerMode: WorkerScalerMode;
  minReplicas: number;
  maxReplicas: number;
  scaleUpSustainSeconds: number;
  scaleCooldownSeconds: number;
}

export type WorkerScalingSettingsField = keyof WorkerScalingSettings;
export type WorkerScalingSettingsOrigin = 'default' | 'saved';

/** Resposta de `GET`/`PUT /admin/workers/settings`. */
export interface WorkerScalingSettingsView {
  settings: WorkerScalingSettings;
  origin: Record<WorkerScalingSettingsField, WorkerScalingSettingsOrigin>;
  /** ISO; `null` = nunca salvo (valores da env). */
  updatedAt: string | null;
  /** `false` com a adoção desligada: o teto não é aplicado. */
  enforced: boolean;
}

/** Corpo de `PUT /admin/workers/settings`. */
export interface UpdateWorkerScalingSettingsInput {
  settings: WorkerScalingSettings;
  /** `updatedAt` lido no GET (409 se outro admin salvou antes). */
  expectedUpdatedAt: string | null;
}

/** Rascunho do formulário: campos numéricos podem vir como texto do input. */
export type WorkerScalingSettingsDraft = {
  [K in WorkerScalingSettingsField]: K extends 'scalerMode' ? WorkerScalerMode : number | string;
};

export interface WorkerScalingSettingsChange {
  field: WorkerScalingSettingsField;
  from: WorkerScalingSettings[WorkerScalingSettingsField];
  to: WorkerScalingSettings[WorkerScalingSettingsField];
}
