import { describe, it, expect } from 'vitest';
import { ListLeaseHoldersUseCase } from './ListLeaseHoldersUseCase';

const leaseUntil = new Date('2026-11-07T12:00:00.000Z');

describe('ListLeaseHoldersUseCase', () => {
  it('soma as sessões com lease vivo por processo', async () => {
    const uc = new ListLeaseHoldersUseCase({
      listLiveHolders: async () => [
        { workerId: 'api-1', sessions: 7, leaseUntil },
        { workerId: 'api-2', sessions: 2, leaseUntil },
      ],
    });
    const out = await uc.execute();
    expect(out.leasedSessions).toBe(9);
    expect(out.processes).toHaveLength(2);
  });

  it('sem lease vivo: zero processos', async () => {
    const uc = new ListLeaseHoldersUseCase({ listLiveHolders: async () => [] });
    expect(await uc.execute()).toEqual({ processes: [], leasedSessions: 0 });
  });
});
