import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { logger } from '../../../../shared/logger/logger';
import { PrismaWorkerScalingSettingsRepository } from './PrismaWorkerScalingSettingsRepository';

/** Sem banco: `findUnique` falso devolve a linha da vez. */
function setup(values: unknown[]) {
  const findUnique = vi.fn();
  for (const value of values) findUnique.mockResolvedValueOnce({ key: 'worker_scaling', value, updatedAt: new Date(0), updatedById: null });
  const repo = new PrismaWorkerScalingSettingsRepository({ platformSetting: { findUnique } } as unknown as PrismaClient);
  return repo;
}

afterEach(() => vi.restoreAllMocks());

describe('PrismaWorkerScalingSettingsRepository.get', () => {
  it('valor não-objeto: warn uma vez até ver um valor bom, sem o conteúdo', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const repo = setup(['segredo', [1], 42, { maxSessionsPerWorker: 3 }, 'segredo']);
    for (let i = 0; i < 3; i++) expect(await repo.get()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await repo.get()).toMatchObject({ value: { maxSessionsPerWorker: 3 } });
    expect(await repo.get()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('segredo');
  });
});
