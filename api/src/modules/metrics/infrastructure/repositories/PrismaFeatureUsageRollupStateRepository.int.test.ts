import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import {
  FEATURE_USAGE_CUTOVER_SETTINGS_KEY,
  FEATURE_USAGE_DROPPED_SETTINGS_KEY,
  FEATURE_USAGE_ROLLUP_SETTINGS_KEY,
  PrismaFeatureUsageRollupStateRepository,
} from './PrismaFeatureUsageRollupStateRepository';
import { createReadBudget } from './featureUsageReadTimeout';

/** Marco do backfill em `platform_settings` contra o Postgres descartável. */
const clean = () =>
  prisma.platformSetting.deleteMany({ where: { key: { in: [FEATURE_USAGE_ROLLUP_SETTINGS_KEY, FEATURE_USAGE_CUTOVER_SETTINGS_KEY, FEATURE_USAGE_DROPPED_SETTINGS_KEY] } } });

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
      backfillStopReason: null,
      backfillCursor: null,
      cutovers: {},
      lastSuccessAt: null,
      finalizedThrough: null,
      failureStreak: 0,
      dropped: {},
    });
  });

  it('cursor e marco são lidos de volta por outra instância; o marco não muda depois de gravado', async () => {
    const writer = new PrismaFeatureUsageRollupStateRepository(prisma, () => new Date('2026-11-17T10:00:00Z'));
    await writer.saveBackfillCursor('2026-11-08');
    expect(await new PrismaFeatureUsageRollupStateRepository(prisma).get()).toEqual({
      backfillCompletedAt: null,
      backfilledFrom: null,
      backfillStopReason: null,
      backfillCursor: '2026-11-08',
      cutovers: {},
      lastSuccessAt: null,
      finalizedThrough: null,
      failureStreak: 0,
      dropped: {},
    });

    const done = new Date('2026-11-17T10:15:00.123Z');
    expect(await writer.markBackfillCompleted({ completedAt: done, backfilledFrom: '2026-10-26', stopReason: 'FIRST_DATA' })).toBe(true);
    expect(await writer.markBackfillCompleted({ completedAt: new Date('2026-11-18T00:00:00Z'), backfilledFrom: '2026-01-01', stopReason: 'RETENTION' })).toBe(false);

    const other = new PrismaFeatureUsageRollupStateRepository(prisma);
    expect(await other.get()).toEqual({ backfillCompletedAt: done, backfilledFrom: '2026-10-26', backfillStopReason: 'FIRST_DATA', backfillCursor: '2026-11-08', cutovers: {}, lastSuccessAt: null, finalizedThrough: null, failureStreak: 0, dropped: {}, backfillPendingKeys: [] });
    // Leitura do painel: mesma resposta, dentro do orçamento do pedido
    expect(await other.get(createReadBudget())).toEqual({ backfillCompletedAt: done, backfilledFrom: '2026-10-26', backfillStopReason: 'FIRST_DATA', backfillCursor: '2026-11-08', cutovers: {}, lastSuccessAt: null, finalizedThrough: null, failureStreak: 0, dropped: {}, backfillPendingKeys: [] });
    const row = await prisma.platformSetting.findUnique({ where: { key: FEATURE_USAGE_ROLLUP_SETTINGS_KEY } });
    expect(row?.updatedById).toBeNull();
    expect(row?.updatedAt.toISOString()).toBe('2026-11-17T10:00:00.000Z');
  });

  it('marco antigo sem motivo vale RETENTION (o conservador)', async () => {
    await prisma.platformSetting.create({
      data: { key: FEATURE_USAGE_ROLLUP_SETTINGS_KEY, value: { backfillCompletedAt: '2026-11-17T10:00:00.000Z', backfilledFrom: '2026-10-26' } },
    });
    expect((await new PrismaFeatureUsageRollupStateRepository(prisma).get()).backfillStopReason).toBe('RETENTION');
  });

  it('valor salvo inválido vira estado vazio e é sobrescrito pelo merge', async () => {
    await prisma.platformSetting.create({ data: { key: FEATURE_USAGE_ROLLUP_SETTINGS_KEY, value: ['x'] } });
    const repo = new PrismaFeatureUsageRollupStateRepository(prisma);
    expect((await repo.get()).backfillCursor).toBeNull();
    await repo.saveBackfillCursor('2026-11-01');
    expect((await repo.get()).backfillCursor).toBe('2026-11-01');
  });

  it('corte do contador: gravado uma vez de forma atômica (corrida de 10), lido com o estado numa instrução', async () => {
    const repo = new PrismaFeatureUsageRollupStateRepository(prisma);
    const days = Array.from({ length: 10 }, (_, i) => `2026-11-${String(19 + i).padStart(2, '0')}`);
    const got = await Promise.all(days.map((d) => repo.claimCutover('offer_story', d)));
    expect(new Set(got).size).toBe(1);
    const winner = got[0]!;
    expect(days).toContain(winner);
    expect(await repo.claimCutover('offer_story', '2027-01-01')).toBe(winner);
    // Outra chave entra sem mexer na primeira
    expect(await repo.claimCutover('view:home', '2026-12-01')).toBe('2026-12-01');
    await repo.saveBackfillCursor('2026-11-01');
    expect((await repo.get(createReadBudget())).cutovers).toEqual({ offer_story: winner, 'view:home': '2026-12-01' });
    expect((await repo.get()).backfillCursor).toBe('2026-11-01');
  });

  it('descartes: soma por dia × chave entre gravações (corrida de 10), poda > 400 dias, lidos com o estado', async () => {
    const repo = new PrismaFeatureUsageRollupStateRepository(prisma, () => new Date('2026-11-17T15:00:00Z'));
    await prisma.platformSetting.create({
      data: { key: FEATURE_USAGE_DROPPED_SETTINGS_KEY, value: { '2025-01-01': { chat_send: 9 }, '2026-11-10': { chat_send: 1, lixo: 'x' } } },
    });
    await Promise.all(Array.from({ length: 10 }, () => repo.addDrops({ '2026-11-10': { chat_send: 2 }, '2026-11-17': { 'view:offers': 1 } })));
    await repo.addDrops({ '2026-11-17': { chat_send: 1 }, 'não-é-dia': { chat_send: 5 } });
    const st = await repo.get(createReadBudget());
    expect(st.dropped).toEqual({ '2026-11-10': { chat_send: 21 }, '2026-11-17': { 'view:offers': 10, chat_send: 1 } });
  });

  it('recordTick: merge sem tocar no marco nem no cursor; campo ausente não muda', async () => {
    const repo = new PrismaFeatureUsageRollupStateRepository(prisma);
    await repo.saveBackfillCursor('2026-11-01');
    await repo.markBackfillCompleted({ completedAt: new Date('2026-11-17T10:00:00Z'), backfilledFrom: '2026-10-26', stopReason: 'RETENTION' });
    const at = new Date('2026-11-17T12:30:00.000Z');
    await repo.recordTick({ failureStreak: 0, lastSuccessAt: at, finalizedThrough: '2026-11-15' });
    await repo.recordTick({ failureStreak: 2 });
    expect(await repo.get(createReadBudget())).toMatchObject({
      backfillCompletedAt: new Date('2026-11-17T10:00:00Z'),
      backfilledFrom: '2026-10-26',
      backfillCursor: '2026-11-01',
      lastSuccessAt: at,
      finalizedThrough: '2026-11-15',
      failureStreak: 2,
    });
  });

  it('estado por grupo, reprocesso, revisita e pendentes do marco: gravados pelo tick e lidos de volta', async () => {
    const repo = new PrismaFeatureUsageRollupStateRepository(prisma);
    await repo.markBackfillCompleted({ completedAt: new Date('2026-11-17T10:00:00Z'), backfilledFrom: '2026-10-26', stopReason: 'FIRST_DATA', pendingKeys: ['link_rotation'] });
    const at = new Date('2026-11-17T12:30:00.000Z');
    const groups = {
      'link_rotation+link_rotation_click': { failureStreak: 3, lastSuccessAt: null, backfillCursor: '2026-11-01', backfillDone: null, backfillFailures: 4, reprocessFrom: '2026-10-02' },
      offer_generator: { failureStreak: 0, lastSuccessAt: at, backfillCursor: null, backfillDone: { from: '2026-10-26', reason: 'FIRST_DATA' as const }, backfillFailures: 0, reprocessFrom: null },
    };
    await repo.recordTick({ failureStreak: 1, groups, retryQueue: [{ day: '2026-11-12', group: 'link_rotation+link_rotation_click' }], revisitCursor: '2026-11-14' });
    const st = await repo.get(createReadBudget());
    expect(st).toMatchObject({ groups, retryQueue: [{ day: '2026-11-12', group: 'link_rotation+link_rotation_click' }], revisitCursor: '2026-11-14', backfillPendingKeys: ['link_rotation'] });
    // Pendente que concluiu sai; o marco não muda
    await repo.recordTick({ failureStreak: 0, backfillPendingKeys: [] });
    expect(await repo.get()).toMatchObject({ backfillPendingKeys: [], backfilledFrom: '2026-10-26', groups });
  });
});
