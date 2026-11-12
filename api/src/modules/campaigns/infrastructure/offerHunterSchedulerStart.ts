import type { OfferHuntSchedulerJob } from './jobs/OfferHuntSchedulerJob';

/** `OFFER_HUNTER_JOB_ENABLED` desligada (ou papel `http`): nada é montado nem ligado (nenhum acesso ao banco). */
export function startOfferHunterSchedulerJob<T extends Pick<OfferHuntSchedulerJob, 'start' | 'stop'>>(
  enabled: boolean,
  factory: () => T,
): T | null {
  if (!enabled) return null;
  const job = factory();
  job.start();
  return job;
}
