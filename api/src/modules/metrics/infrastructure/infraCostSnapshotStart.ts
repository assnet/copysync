import type { InfraCostSnapshotJob } from './jobs/InfraCostSnapshotJob';

export interface InfraCostSnapshotJobHandle {
  job: Pick<InfraCostSnapshotJob, 'start' | 'stop'>;
  renderConfigured: boolean;
}

/** `INFRA_COST_SNAPSHOT_ENABLED` desligada: nada é montado nem ligado (nenhuma leitura, nenhuma chamada). */
export function startInfraCostSnapshotJob<T extends InfraCostSnapshotJobHandle>(enabled: boolean, factory: () => T): T | null {
  if (!enabled) return null;
  const handle = factory();
  handle.job.start();
  return handle;
}
