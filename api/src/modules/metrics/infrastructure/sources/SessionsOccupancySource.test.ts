import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { OpsMetricReading } from '../../domain/OpsMetric';
import { SessionsOccupancySource } from './SessionsOccupancySource';

/** Falha da contagem de aguardando não derruba as outras métricas do tick. */
const prisma = {
  $executeRawUnsafe: vi.fn(() => 'set'),
  $queryRaw: vi.fn(() => 'query'),
  $transaction: vi.fn(async () => [0, [{ connected: 3, pending: 1, owners: 1 }]]),
} as unknown as PrismaClient;

const build = (countAwaitingCapacity: () => Promise<number>) => {
  const src = new SessionsOccupancySource({
    prisma,
    adoptionEnabled: () => true,
    adoption: { countAwaitingCapacity },
    heartbeats: { listAlive: async () => [{ maxSessions: 10 }] as never },
    maxSessionsPerWorker: () => 25,
  });
  const warn = vi.fn();
  (src as unknown as { log: unknown }).log = { warn };
  return { src, warn };
};
const values = (out: OpsMetricReading[]) => Object.fromEntries(out.map((r) => [r.metric, r.value]));

describe('SessionsOccupancySource — falha de aguardando', () => {
  it('omite sessions_awaiting, mantém as outras 3 e loga warn 1× por sequência de falhas', async () => {
    let fail = true;
    const count = vi.fn(async () => {
      if (fail) throw new Error('canceling statement due to statement timeout');
      return 4;
    });
    const { src, warn } = build(count);

    const first = values(await src.read());
    expect(first).toEqual({ sessions_connected: 3, sessions_pending_login: 1, sessions_capacity: 10 });
    await src.read();
    expect(warn).toHaveBeenCalledTimes(1);

    fail = false;
    expect(values(await src.read())).toEqual({
      sessions_connected: 3, sessions_pending_login: 1, sessions_awaiting: 4, sessions_capacity: 10,
    });

    fail = true;
    await src.read();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
