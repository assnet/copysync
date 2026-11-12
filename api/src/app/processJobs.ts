import type { ProcessRole } from '../shared/config/processRole';

/**
 * Jobs de boot que o `server.ts` liga por papel (docs/arquitetura-escala.md §3.3).
 * A flag de cada job continua valendo: a tabela só diz em que processo ele pode rodar.
 */
export type ProcessJob =
  | 'uploadSweeper'
  | 'interruptedUploads'
  | 'pendingMediaBoot'
  | 'pendingMediaSweep'
  | 'offerDispatch'
  | 'hubOutbox'
  | 'extensionRetention'
  | 'billingReconcile'
  | 'linkRotationSync'
  | 'sessionBootstrap'
  | 'sessionReconciler'
  | 'leaseKeeper'
  /** Adoção por capacidade (ADOPT-07); só com `WORKER_ADOPTION_ENABLED`. */
  | 'sessionAdoption'
  /** Batimento em `worker_heartbeats` (ADOPT-10); só com a flag. */
  | 'workerHeartbeat'
  /** Alerta de capacidade dos workers (ADOPT-11); só com a flag. */
  | 'capacityAlert'
  /** Chaves órfãs de `outbound-tmp/` no storage; só onde há composição `worker` (em `all` não há `stage`). */
  | 'outboundTmpSweep'
  /** Métricas de Render/Postgres/workers (MQ-22); só com `OPS_METRICS_SAMPLER_ENABLED`. Nunca no `http`. */
  | 'opsMetricsSampler'
  /** Subida automática de workers (WSCALE-15); só age com `scalerMode = auto`. Nunca no `http`. */
  | 'workerAutoscaler';

/** Uploads em partes e mídia pendente: disco/fila do processo que recebe o upload. */
const HTTP_JOBS: readonly ProcessJob[] = ['uploadSweeper', 'interruptedUploads', 'pendingMediaBoot', 'pendingMediaSweep'];

/** Envios, integrações e sessões: processo dono dos sockets. */
const WORKER_JOBS: readonly ProcessJob[] = [
  'offerDispatch',
  'hubOutbox',
  'extensionRetention',
  'billingReconcile',
  'linkRotationSync',
  'sessionBootstrap',
  'sessionReconciler',
  'leaseKeeper',
  'sessionAdoption',
  'workerHeartbeat',
  'capacityAlert',
  'outboundTmpSweep',
  'opsMetricsSampler',
  'workerAutoscaler',
];

/** Jobs que este papel liga. `all` = todos (comportamento de hoje). */
export function jobsFor(role: ProcessRole): ReadonlySet<ProcessJob> {
  if (role === 'http') return new Set(HTTP_JOBS);
  if (role === 'worker') return new Set(WORKER_JOBS);
  return new Set([...HTTP_JOBS, ...WORKER_JOBS]);
}
