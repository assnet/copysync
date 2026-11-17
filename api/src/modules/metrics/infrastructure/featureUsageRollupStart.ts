import type { FeatureUsageRollupJob } from './jobs/FeatureUsageRollupJob';

export type FeatureUsageRollupJobHandle = Pick<FeatureUsageRollupJob, 'start' | 'stop'>;

/** `FEATURE_USAGE_ROLLUP_ENABLED` desligada (ou papel `http`): nada é montado nem ligado. Ligada: só arma o timer. */
export function startFeatureUsageRollupJob<T extends FeatureUsageRollupJobHandle>(enabled: boolean, factory: () => T): T | null {
  if (!enabled) return null;
  const job = factory();
  job.start();
  return job;
}
