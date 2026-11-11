import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { PrismaWorkerScalingSettingsRepository } from './PrismaWorkerScalingSettingsRepository';

/** Sem banco: `findUnique` falso devolve a linha da vez. */
function setup(values: unknown[]) {
  const findUnique = vi.fn();
  for (const value of values) {
    findUnique.mockResolvedValueOnce({ key: 'worker_scaling', value, updatedAt: new Date(7), updatedById: 'u1' });
  }
  return new PrismaWorkerScalingSettingsRepository({ platformSetting: { findUnique } } as unknown as PrismaClient);
}

describe('PrismaWorkerScalingSettingsRepository.get', () => {
  it('valor não-objeto: devolve a linha com updatedAt/updatedById reais e o valor cru', async () => {
    const repo = setup(['texto', [1], 42, { maxSessionsPerWorker: 3 }]);
    for (const value of ['texto', [1], 42, { maxSessionsPerWorker: 3 }]) {
      expect(await repo.get()).toEqual({ value, updatedAt: new Date(7), updatedById: 'u1' });
    }
  });

  it('sem linha → null', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const repo = new PrismaWorkerScalingSettingsRepository({ platformSetting: { findUnique } } as unknown as PrismaClient);
    expect(await repo.get()).toBeNull();
  });
});
