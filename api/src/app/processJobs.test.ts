import { describe, expect, it } from 'vitest';
import { jobsFor, type ProcessJob } from './processJobs';

const ALL: ProcessJob[] = [
  'uploadSweeper', 'interruptedUploads', 'pendingMediaBoot', 'pendingMediaSweep',
  'offerDispatch', 'hubOutbox', 'extensionRetention', 'billingReconcile',
  'linkRotationSync', 'sessionBootstrap', 'sessionReconciler', 'leaseKeeper',
];

describe('jobsFor', () => {
  it('all liga os 12 jobs', () => {
    expect([...jobsFor('all')].sort()).toEqual([...ALL].sort());
  });

  it('http e worker não compartilham job', () => {
    const worker = jobsFor('worker');
    expect([...jobsFor('http')].filter((j) => worker.has(j))).toEqual([]);
  });

  it('http ∪ worker = all', () => {
    const union = new Set([...jobsFor('http'), ...jobsFor('worker')]);
    expect([...union].sort()).toEqual([...jobsFor('all')].sort());
  });

  it('http fica com uploads e mídia pendente; worker com sessões e lease', () => {
    expect([...jobsFor('http')].sort()).toEqual(
      ['interruptedUploads', 'pendingMediaBoot', 'pendingMediaSweep', 'uploadSweeper'],
    );
    const worker = jobsFor('worker');
    for (const j of ['sessionBootstrap', 'sessionReconciler', 'leaseKeeper', 'offerDispatch'] as const) {
      expect(worker.has(j)).toBe(true);
    }
  });
});
