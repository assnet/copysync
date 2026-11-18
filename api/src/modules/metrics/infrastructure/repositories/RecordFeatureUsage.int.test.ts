import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { RecordFeatureUsageUseCase } from '../../application/use-cases/RecordFeatureUsageUseCase';
import { readUsageRows } from '../../application/use-cases/GetFeatureUsageSummaryUseCase';
import { findFeature } from '../../domain/services/featureUsageCatalog';
import { PrismaDailyFeatureUsageReader } from './PrismaDailyFeatureUsageReader';
import { PrismaFeatureUsageDailyRepository } from './PrismaFeatureUsageDailyRepository';
import { FEATURE_USAGE_CUTOVER_SETTINGS_KEY, PrismaFeatureUsageRollupStateRepository } from './PrismaFeatureUsageRollupStateRepository';
import { PrismaLiveFeatureUsageReader } from './PrismaLiveFeatureUsageReader';
import { createReadBudget } from './featureUsageReadTimeout';

/**
 * Uma fonte por dia para o Story (design §4.5): a primeira escrita do contador grava o corte (dia seguinte) em
 * `platform_settings`; antes dele conta o título da IA (`ai_usage_logs`), do corte em diante só o contador. O chat
 * conta desde a primeira escrita. Banco em `America/Sao_Paulo` (≠ UTC).
 */
const s = `rfu${Date.now().toString(36)}`;
const A = `${s}-ta`;
let dbName = '';
let n = 0;
const state = new PrismaFeatureUsageRollupStateRepository(prisma);
const recorder = new RecordFeatureUsageUseCase({ daily: new PrismaFeatureUsageDailyRepository(prisma), cutovers: state });
const clearCutover = () => prisma.platformSetting.deleteMany({ where: { key: FEATURE_USAGE_CUTOVER_SETTINGS_KEY } });
const ai = (at: string) =>
  prisma.$executeRawUnsafe(`INSERT INTO ai_usage_logs (id, "tenantId", source, kind, model, purpose, success, "createdAt")
    VALUES ('${s}-ai${n++}', '${A}', 'PLATFORM', 'OPENAI', 'm', 'offer_story_headline', true, '${at}')`);
// Véspera e dia do corte em Brasília: [11-18 03:00Z, 11-20 03:00Z)
const window = () => ({
  from: new Date('2026-11-18T03:00:00Z'),
  toExclusive: new Date('2026-11-20T03:00:00Z'),
  featureKeys: ['offer_story', 'chat_send'] as const,
  granularity: 'day' as const,
  budget: createReadBudget(),
});
const mine = <T extends { tenantId: string }>(rows: T[]) => rows.filter((r) => r.tenantId === A);

beforeAll(async () => {
  dbName = (await prisma.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`)[0]!.d;
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'America/Sao_Paulo'`);
  await prisma.$disconnect();
  await prisma.$executeRawUnsafe(`INSERT INTO tenants (id, name, slug, "updatedAt") VALUES ('${A}', 'x', '${A}', now())`);
  await clearCutover();
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM ai_usage_logs WHERE "tenantId" = '${A}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${A}'`);
  await clearCutover();
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'UTC'`);
  await prisma.$disconnect();
});

describe('contador do Story e do chat contra o banco', () => {
  it('primeira escrita do Story grava o corte (dia seguinte, uma vez); o dia dela fica com a fonte viva; chat conta desde já', async () => {
    expect((await state.get()).cutovers).toEqual({});
    // 18/11 em Brasília: primeira escrita do Story grava corte 19 e não conta
    await ai('2026-11-18 15:00:00');
    await recorder.increment({ tenantId: A, featureKey: 'offer_story', kind: 'ACTION', at: new Date('2026-11-18T15:00:00Z') });
    expect((await state.get()).cutovers).toEqual({ offer_story: '2026-11-19' });
    // Outro processo tentando outro corte recebe o já gravado
    expect(await state.claimCutover('offer_story', '2026-11-30')).toBe('2026-11-19');
    // chat conta desde a primeira escrita (00:30 UTC do dia 19 = 18 em Brasília)
    await recorder.increment({ tenantId: A, featureKey: 'chat_send', kind: 'ACTION', at: new Date('2026-11-19T00:30:00Z') });
    // 19/11 em Brasília (00:30 UTC do dia 20 ainda é 19)
    await ai('2026-11-19 15:00:00');
    await recorder.increment({ tenantId: A, featureKey: 'offer_story', kind: 'ACTION', at: new Date('2026-11-19T15:00:00Z') });
    await recorder.increment({ tenantId: A, featureKey: 'chat_send', kind: 'ACTION', at: new Date('2026-11-20T00:30:00Z') });

    const daily = mine((await new PrismaDailyFeatureUsageReader(prisma).read(window())).rows);
    expect(daily.map((r) => [r.day, r.featureKey, r.kind, r.uses]).sort()).toEqual([
      ['2026-11-18', 'chat_send', 'ACTION', 1],
      ['2026-11-19', 'chat_send', 'ACTION', 1],
      ['2026-11-19', 'offer_story', 'ACTION', 1],
    ]);

    // Leitura sob demanda com o corte gravado: 18 da IA, 19 do contador (a linha da IA do dia 19 não conta)
    const { cutovers } = await state.get(createReadBudget());
    const deps = { reader: new PrismaLiveFeatureUsageReader(prisma), dailyReader: new PrismaDailyFeatureUsageReader(prisma) } as never;
    const out = await readUsageRows(deps, {
      ...window(),
      features: [findFeature('offer_story')!, findFeature('chat_send')!],
      source: 'live',
      cutovers,
    });
    expect(mine(out.rows).map((r) => [r.day, r.featureKey, r.uses]).sort()).toEqual([
      ['2026-11-18', 'chat_send', 1],
      ['2026-11-18', 'offer_story', 1],
      ['2026-11-19', 'chat_send', 1],
      ['2026-11-19', 'offer_story', 1],
    ]);
    expect(out.firstDataDay['chat_send']).toBe('2026-11-18');
  });
});
