import type { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { InfraCostSettingsConflictError } from '../../../../shared/errors/internal/InfraCostErrors';
import {
  defaultInfraCostSettings,
  resolveInfraCostSettings,
  type InfraCostSettings,
} from '../../domain/services/infraCostSettings';
import { INFRA_COST_SETTINGS_KEY, PrismaInfraCostSettingsRepository } from './PrismaInfraCostSettingsRepository';

/** Configuração de custos (COST-01/03) contra Postgres local: concorrência por `updatedAt`. */
const repo = new PrismaInfraCostSettingsRepository(prisma);
const where = { key: INFRA_COST_SETTINGS_KEY };
const settings = (fxRate?: number): InfraCostSettings => {
  const s = defaultInfraCostSettings();
  return fxRate === undefined ? s : { ...s, fx: { ...s.fx, override: { rate: fxRate, date: '2026-11-12' } } };
};

beforeEach(async () => {
  await prisma.platformSetting.deleteMany({ where });
});
afterAll(async () => {
  await prisma.platformSetting.deleteMany({ where });
  await prisma.$disconnect();
});

describe('migration add_audit_action_infra_costs', () => {
  it('enum AuditAction tem INFRA_COST_SETTINGS_CHANGED', async () => {
    const rows = await prisma.$queryRaw<{ v: string }[]>`
      SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'AuditAction' AND e.enumlabel = 'INFRA_COST_SETTINGS_CHANGED'`;
    expect(rows).toHaveLength(1);
  });
});

describe('get', () => {
  it('sem linha → null', async () => {
    expect(await repo.get()).toBeNull();
  });

  it('linha inválida → crua com o updatedAt real; resolve dá default; o update com ela grava', async () => {
    const put = (value: Prisma.InputJsonValue) =>
      prisma.platformSetting.upsert({ where, create: { ...where, value }, update: { value } });
    for (const value of [[1, 2], 'texto', 42, { items: 'x' }]) {
      const row = await put(value);
      const read = await repo.get();
      expect(read).toEqual({ value, updatedAt: row.updatedAt, updatedById: null });
      expect(resolveInfraCostSettings(read)).toEqual({ value: defaultInfraCostSettings(), origin: 'default' });
    }
    const read = await repo.get();
    const saved = await repo.save(settings(), 'admin-1', read!.updatedAt);
    expect(await repo.get()).toEqual(saved);
    expect(resolveInfraCostSettings(saved).origin).toBe('saved');
  });
});

describe('save', () => {
  it('cria com expectedUpdatedAt null e get devolve o gravado', async () => {
    const saved = await repo.save(settings(), 'admin-1', null);
    expect(saved).toMatchObject({ value: settings(), updatedById: 'admin-1' });
    expect(await repo.get()).toEqual(saved);
    // `updatedAt` em UTC (sem deslocamento de fuso) e utilizável pelo update condicionado.
    expect(Math.abs(saved.updatedAt.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('create com linha existente → conflito, sem gravar', async () => {
    const first = await repo.save(settings(), 'admin-1', null);
    await expect(repo.save(settings(6), 'admin-2', null)).rejects.toBeInstanceOf(InfraCostSettingsConflictError);
    expect(await repo.get()).toEqual(first);
  });

  it('create concorrente: um vence, o outro é conflito', async () => {
    const results = await Promise.allSettled([
      repo.save(settings(5), 'a', null),
      repo.save(settings(6), 'b', null),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(InfraCostSettingsConflictError);
  });

  it('atualiza com o updatedAt lido; updatedAt avança', async () => {
    const first = await repo.save(settings(), 'admin-1', null);
    const second = await repo.save(settings(6), 'admin-2', first.updatedAt);
    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
    expect(await repo.get()).toEqual({ value: settings(6), updatedAt: second.updatedAt, updatedById: 'admin-2' });
  });

  it('expectedUpdatedAt velho → conflito, sem gravar', async () => {
    const first = await repo.save(settings(), 'admin-1', null);
    const second = await repo.save(settings(6), 'admin-2', first.updatedAt);
    await expect(repo.save(settings(7), 'admin-3', first.updatedAt)).rejects.toBeInstanceOf(InfraCostSettingsConflictError);
    expect(await repo.get()).toEqual(second);
  });

  it('update concorrente com o mesmo updatedAt: um vence', async () => {
    const first = await repo.save(settings(), 'admin-1', null);
    const results = await Promise.allSettled([
      repo.save(settings(5), 'a', first.updatedAt),
      repo.save(settings(6), 'b', first.updatedAt),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('expectedUpdatedAt com linha apagada → conflito', async () => {
    await expect(repo.save(settings(), 'admin-1', new Date())).rejects.toBeInstanceOf(InfraCostSettingsConflictError);
  });
});
