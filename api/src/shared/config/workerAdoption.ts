import { env, type Env } from './env';
import type { WorkerScalingEnvDefaults } from '../../modules/sessions/domain/services/workerScalingSettings';

/**
 * Configuração da adoção por capacidade, lida das envs já validadas. Os tetos não moram aqui:
 * vêm da configuração de escala (`workerScalingSettingsProvider()`), com a env só como valor inicial.
 */
export interface WorkerAdoptionConfig {
  enabled: boolean;
  shard: string | null;
}

type WorkerAdoptionEnv = Pick<Env, 'WORKER_ADOPTION_ENABLED' | 'WORKER_SHARD'>;
type WorkerScalingEnv = Pick<Env, 'WORKER_MAX_SESSIONS' | 'WORKER_MAX_PENDING_LOGINS'>;

/** Lê as envs da adoção (sem regra). `WORKER_SHARD` ausente/vazio → `null`. */
export function workerAdoptionConfig(source: WorkerAdoptionEnv = env): WorkerAdoptionConfig {
  return {
    enabled: source.WORKER_ADOPTION_ENABLED,
    shard: source.WORKER_SHARD ?? null,
  };
}

/**
 * Único ponto que lê `WORKER_MAX_SESSIONS`/`WORKER_MAX_PENDING_LOGINS` (WSCALE-02): o default da
 * configuração de escala sem linha salva ou com o banco fora no boot.
 */
export function workerScalingEnvDefaults(source: WorkerScalingEnv = env): WorkerScalingEnvDefaults {
  return {
    maxSessionsPerWorker: source.WORKER_MAX_SESSIONS,
    maxPendingLoginsPerWorker: source.WORKER_MAX_PENDING_LOGINS,
  };
}
