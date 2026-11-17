import type { SaverExtractionJob } from './SaverExtractionJob';

/** `SAVER_EXTRACTION_WORKER_ENABLED` desligada (ou papel `http`): nada é montado nem ligado (nenhum acesso ao banco). */
export function startSaverExtractionJob<T extends Pick<SaverExtractionJob, 'start' | 'stop'>>(
  enabled: boolean,
  factory: () => T,
): T | null {
  if (!enabled) return null;
  const job = factory();
  job.start();
  return job;
}
