import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { logger } from '../../../../shared/logger/logger';
import { WorkerScalingSettingsConflictError } from '../../../../shared/errors/internal/WorkerScalingErrors';
import { PrismaWorkerScalingSettingsRepository, WORKER_SCALING_SETTINGS_KEY } from './PrismaWorkerScalingSettingsRepository';

/** Configuração de escala (WSCALE-01/06) contra Postgres local: concorrência por `updatedAt`. */
const repo = new PrismaWorkerScalingSettingsRepository(prisma);
const where = { key: WORKER_SCALING_SETTINGS_KEY };

beforeEach(async () => {
  await prisma.platformSetting.deleteMany({ where });
});
afterAll(async () => {
  await prisma.platformSetting.deleteMany({ where });
  await prisma.$disconnect();
});

describe('migration add_audit_action_worker_scaling', () => {
  it('enum AuditAction tem os dois valores novos', async () => {
    const rows = await prisma.$queryRaw<{ v: string }[]>`
      SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'AuditAction' AND e.enumlabel IN ('WORKER_SCALING_SETTINGS_CHANGED', 'WORKER_SCALE_REQUESTED')`;
    expect(rows.map((r) => r.v).sort()).toEqual(['WORKER_SCALE_REQUESTED', 'WORKER_SCALING_SETTINGS_CHANGED']);
  });
});

describe('get', () => {
  it('sem linha → null', async () => {
    expect(await repo.get()).toBeNull();
  });

  it('JSON que não é objeto → null + warn sem o conteúdo', async () => {
    const warn = vi.spyOn(logger, 'warn');
    for (const value of [[1, 2], 'segredo', 42]) {
      await prisma.platformSetting.upsert({ where, create: { ...where, value }, update: { value } });
      expect(await repo.get()).toBeNull();
    }
    expect(warn).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('segredo');
  });
});

describe('save', () => {
  it('cria com expectedUpdatedAt null e get devolve o gravado', async () => {
    const saved = await repo.save({ maxSessionsPerWorker: 30 }, 'admin-1', null);
    expect(saved).toMatchObject({ value: { maxSessionsPerWorker: 30 }, updatedById: 'admin-1' });
    expect(await repo.get()).toEqual(saved);
  });

  it('create com linha existente → conflito, sem gravar', async () => {
    const first = await repo.save({ maxSessionsPerWorker: 30 }, 'admin-1', null);
    await expect(repo.save({ maxSessionsPerWorker: 50 }, 'admin-2', null)).rejects.toBeInstanceOf(WorkerScalingSettingsConflictError);
    expect(await repo.get()).toEqual(first);
  });

  it('create concorrente: um vence, o outro é conflito', async () => {
    const results = await Promise.allSettled([
      repo.save({ maxSessionsPerWorker: 10 }, 'a', null),
      repo.save({ maxSessionsPerWorker: 20 }, 'b', null),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(WorkerScalingSettingsConflictError);
  });

  it('atualiza com o updatedAt lido; updatedAt avança', async () => {
    const first = await repo.save({ maxSessionsPerWorker: 30 }, 'admin-1', null);
    const second = await repo.save({ maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 3 }, 'admin-2', first.updatedAt);
    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
    expect(await repo.get()).toEqual({ value: { maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 3 }, updatedAt: second.updatedAt, updatedById: 'admin-2' });
  });

  it('expectedUpdatedAt velho → conflito, sem gravar', async () => {
    const first = await repo.save({ maxSessionsPerWorker: 30 }, 'admin-1', null);
    const second = await repo.save({ maxSessionsPerWorker: 40 }, 'admin-2', first.updatedAt);
    await expect(repo.save({ maxSessionsPerWorker: 99 }, 'admin-3', first.updatedAt)).rejects.toBeInstanceOf(WorkerScalingSettingsConflictError);
    expect(await repo.get()).toEqual(second);
  });

  it('update concorrente com o mesmo updatedAt: um vence', async () => {
    const first = await repo.save({ maxSessionsPerWorker: 30 }, 'admin-1', null);
    const results = await Promise.allSettled([
      repo.save({ maxSessionsPerWorker: 41 }, 'a', first.updatedAt),
      repo.save({ maxSessionsPerWorker: 42 }, 'b', first.updatedAt),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('expectedUpdatedAt com linha apagada → conflito', async () => {
    await expect(repo.save({ maxSessionsPerWorker: 30 }, 'admin-1', new Date())).rejects.toBeInstanceOf(WorkerScalingSettingsConflictError);
  });
});
