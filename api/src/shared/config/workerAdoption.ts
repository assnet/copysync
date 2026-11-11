import { env, type Env } from './env';
import {
  WORKER_SCALING_RANGES,
  type WorkerScalingEnvDefaults,
} from '../../modules/sessions/domain/services/workerScalingSettings';
import { logger } from '../logger/logger';

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

/** Recorte do logger usado no clamp (pino). */
export interface WorkerScalingEnvLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

const warnedEnv = new Set<string>();

/** Limita à faixa do domínio; acima do limite loga `warn` uma vez por env no processo. */
function clampEnv(
  name: string,
  raw: number,
  range: { min: number; max: number },
  log: WorkerScalingEnvLogger,
): number {
  const value = Math.min(range.max, Math.max(range.min, raw));
  if (value !== raw && !warnedEnv.has(name)) {
    warnedEnv.add(name);
    log.warn({ env: name, value: raw, min: range.min, max: range.max }, 'worker scaling env out of range; clamped');
  }
  return value;
}

/**
 * Único ponto que lê `WORKER_MAX_SESSIONS`/`WORKER_MAX_PENDING_LOGINS` (WSCALE-02): o default da
 * configuração de escala sem linha salva ou com o banco fora no boot. Limitado às faixas de
 * `WORKER_SCALING_RANGES` (o `env.ts` só exige inteiro positivo, para não quebrar o boot).
 */
export function workerScalingEnvDefaults(
  source: WorkerScalingEnv = env,
  log: WorkerScalingEnvLogger = logger,
): WorkerScalingEnvDefaults {
  return {
    maxSessionsPerWorker: clampEnv('WORKER_MAX_SESSIONS', source.WORKER_MAX_SESSIONS, WORKER_SCALING_RANGES.maxSessionsPerWorker, log),
    maxPendingLoginsPerWorker: clampEnv(
      'WORKER_MAX_PENDING_LOGINS', source.WORKER_MAX_PENDING_LOGINS, WORKER_SCALING_RANGES.maxPendingLoginsPerWorker, log,
    ),
  };
}

/** Só testes: zera o controle de warn único. */
export function resetWorkerScalingEnvWarningsForTests(): void {
  warnedEnv.clear();
}
