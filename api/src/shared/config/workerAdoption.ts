import { env, type Env } from './env';

/** Configuração da adoção por capacidade, lida das envs já validadas. */
export interface WorkerAdoptionConfig {
  enabled: boolean;
  maxSessions: number;
  shard: string | null;
}

type WorkerAdoptionEnv = Pick<Env, 'WORKER_ADOPTION_ENABLED' | 'WORKER_MAX_SESSIONS' | 'WORKER_SHARD'>;

/** Lê as 3 envs da adoção (sem regra). `WORKER_SHARD` ausente/vazio → `null`. */
export function workerAdoptionConfig(source: WorkerAdoptionEnv = env): WorkerAdoptionConfig {
  return {
    enabled: source.WORKER_ADOPTION_ENABLED,
    maxSessions: source.WORKER_MAX_SESSIONS,
    shard: source.WORKER_SHARD ?? null,
  };
}
