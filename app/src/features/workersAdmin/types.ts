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

/** Sessões por canal num plano (WSCALE-09). `contracted` soma só tenants com limite finito. */
export interface WorkerCapacityChannel {
  contracted: number;
  /** Tenants sem limite neste canal (não entram em `contracted`). */
  unlimitedTenants: number;
  created: number;
  /** Lease vivo + `CONNECTED` (contagem do banco). */
  connected: number;
}

/** Linha por plano: só contagens, sem tenant individual. `planSlug: null` = tenants sem plano. */
export interface WorkerCapacityPlan {
  planSlug: string | null;
  tenants: number;
  whatsapp: WorkerCapacityChannel;
  telegram: WorkerCapacityChannel;
}

/** Cluster pela última amostra `sessions_*` da última hora. `sampledAt: null` = sem amostra (números viram 0). */
export interface WorkerCapacityCluster {
  capacity: number;
  connected: number;
  occupancyPct: number;
  headroom: number;
  requiredReplicas: number;
  /** `null` = sem medição de memória. */
  mbPerSession: number | null;
  suggestedMaxSessions: number | null;
  memoryLimitMb: number | null;
  sampledAt: string | null;
  /** `true` = última amostra com mais de 10 min (coletor possivelmente parado). Ausente em API antiga. */
  stale?: boolean;
}

/** Resposta de `GET /admin/workers/capacity` (WSCALE-09/10). */
export interface WorkerCapacityView {
  plans: WorkerCapacityPlan[];
  cluster: WorkerCapacityCluster;
  settings: Pick<WorkerScalingSettings, 'maxSessionsPerWorker' | 'alertOccupancyRatio'>;
  enforced: boolean;
}

/** Variável de ambiente que falta para o escalador funcionar (WSCALE-11). */
export type WorkerScalerMissingEnv = 'WORKER_SCALER_ENABLED' | 'RENDER_API_KEY' | 'WORKER_SCALER_SERVICE_ID';
export type WorkerScalerFailureReason = 'auth' | 'not_found' | 'rejected_by_provider' | 'rate_limited' | 'upstream' | 'timeout';

/** Estado do escalador no provedor (cache de 30 s na API). Nunca carrega chave nem id do serviço. */
export type WorkerScalerState =
  | { status: 'ready'; desiredReplicas: number; runningReplicas: number; hasDisk: boolean; autoscalingEnabled: boolean }
  | { status: 'not_configured'; missing: WorkerScalerMissingEnv[] }
  | { status: 'unavailable'; reason: WorkerScalerFailureReason };

export type WorkerScaleTrigger = 'manual' | 'auto';
export type WorkerScaleOutcome = 'requested' | 'succeeded' | 'failed' | 'rejected';

/** Evento de escala sem identificar o ator (quem pediu fica na auditoria). */
export interface WorkerScaleEvent {
  id: number;
  at: string;
  trigger: WorkerScaleTrigger;
  fromReplicas: number;
  toReplicas: number;
  reason: string;
  outcome: WorkerScaleOutcome;
  error: string | null;
}

/** Resposta de `GET /admin/workers/scale` (WSCALE-14). */
export interface WorkerScaleStateView {
  scaler: WorkerScalerState;
  settings: Pick<WorkerScalingSettings, 'scalerMode' | 'minReplicas' | 'maxReplicas' | 'scaleCooldownSeconds'>;
  /** ISO; fim do intervalo mínimo desde a última escalada bem-sucedida. `null` = sem espera. */
  cooldownUntil: string | null;
  lastEvent: WorkerScaleEvent | null;
  /** Evento automático mais recente (`null` = nenhum). Ausente em API antiga: cai no histórico. */
  lastAutoEvent?: WorkerScaleEvent | null;
  /** `false` com a adoção desligada: o pedido é recusado (`ADOPTION_DISABLED`). */
  enforced: boolean;
}

/** Corpo de `POST /admin/workers/scale`. `requestId` torna o pedido idempotente. */
export interface WorkerScaleRequestInput {
  replicas: number;
  reason: string;
  requestId: string;
}

export interface WorkerScaleRequestResult {
  event: WorkerScaleEvent;
  /** `true` = mesmo `requestId` já processado: nada novo foi pedido ao provedor. */
  replayed: boolean;
}

/** Página de `GET /admin/workers/scale/events` (cursor opaco do servidor). */
export interface WorkerScaleEventsPage {
  items: WorkerScaleEvent[];
  nextCursor: string | null;
}
