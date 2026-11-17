import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import {
  FEATURE_USAGE_ROLLUP_SETTINGS_KEY,
  PrismaFeatureUsageRollupStateRepository,
} from './PrismaFeatureUsageRollupStateRepository';
import { createReadBudget } from './featureUsageReadTimeout';

/** Marco do backfill em `platform_settings` contra o Postgres descartável. */
const clean = () => prisma.platformSetting.deleteMany({ where: { key: FEATURE_USAGE_ROLLUP_SETTINGS_KEY } });

beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe('PrismaFeatureUsageRollupStateRepository', () => {
  it('sem linha devolve tudo null', async () => {
    expect(await new PrismaFeatureUsageRollupStateRepository(prisma).get()).toEqual({
      backfillCompletedAt: null,
      backfilledFrom: null,
      backfillCursor: null,
    });
  });

  it('cursor e marco são lidos de volta por outra instância; o marco não muda depois de gravado', async () => {
    const writer = new PrismaFeatureUsageRollupStateRepository(prisma, () => new Date('2026-11-17T10:00:00Z'));
    await writer.saveBackfillCursor('2026-11-08');
    expect(await new PrismaFeatureUsageRollupStateRepository(prisma).get()).toEqual({
      backfillCompletedAt: null,
      backfilledFrom: null,
      backfillCursor: '2026-11-08',
    });

    const done = new Date('2026-11-17T10:15:00.123Z');
    expect(await writer.markBackfillCompleted({ completedAt: done, backfilledFrom: '2026-10-26' })).toBe(true);
    expect(await writer.markBackfillCompleted({ completedAt: new Date('2026-11-18T00:00:00Z'), backfilledFrom: '2026-01-01' })).toBe(false);

    const other = new PrismaFeatureUsageRollupStateRepository(prisma);
    expect(await other.get()).toEqual({ backfillCompletedAt: done, backfilledFrom: '2026-10-26', backfillCursor: '2026-11-08' });
    // Leitura do painel: mesma resposta, dentro do orçamento do pedido
    expect(await other.get(createReadBudget())).toEqual({ backfillCompletedAt: done, backfilledFrom: '2026-10-26', backfillCursor: '2026-11-08' });
    const row = await prisma.platformSetting.findUnique({ where: { key: FEATURE_USAGE_ROLLUP_SETTINGS_KEY } });
    expect(row?.updatedById).toBeNull();
    expect(row?.updatedAt.toISOString()).toBe('2026-11-17T10:00:00.000Z');
  });

  it('valor salvo inválido vira estado vazio e é sobrescrito pelo merge', async () => {
    await prisma.platformSetting.create({ data: { key: FEATURE_USAGE_ROLLUP_SETTINGS_KEY, value: ['x'] } });
    const repo = new PrismaFeatureUsageRollupStateRepository(prisma);
    expect((await repo.get()).backfillCursor).toBeNull();
    await repo.saveBackfillCursor('2026-11-01');
    expect((await repo.get()).backfillCursor).toBe('2026-11-01');
  });
});
