import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { RecordFeatureUsageUseCase } from '../../application/use-cases/RecordFeatureUsageUseCase';
import { OFFER_STORY_RECORDED_FROM } from '../../domain/services/featureUsageCatalog';
import { PrismaDailyFeatureUsageReader } from './PrismaDailyFeatureUsageReader';
import { PrismaFeatureUsageDailyRepository } from './PrismaFeatureUsageDailyRepository';
import { PrismaLiveFeatureUsageReader } from './PrismaLiveFeatureUsageReader';
import { createReadBudget } from './featureUsageReadTimeout';

/**
 * Uma fonte por dia para o Story (design §4.5): da véspera do corte para trás conta o título da IA
 * (`ai_usage_logs`); do corte em diante só o contador. Banco em `America/Sao_Paulo` (≠ UTC).
 */
const s = `rfu${Date.now().toString(36)}`;
const A = `${s}-ta`;
let dbName = '';
let n = 0;
const recorder = new RecordFeatureUsageUseCase({ daily: new PrismaFeatureUsageDailyRepository(prisma) });
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
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM ai_usage_logs WHERE "tenantId" = '${A}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${A}'`);
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${dbName}" SET timezone = 'UTC'`);
  await prisma.$disconnect();
});

describe('contador do Story e do chat contra o banco', () => {
  it('véspera: o contador não grava e a fonte viva conta; dia do corte: o contador soma e a linha da IA não conta', async () => {
    expect(OFFER_STORY_RECORDED_FROM).toBe('2026-11-19');
    // 18/11 em Brasília (inclusive 00:30 UTC do dia 19, ainda véspera)
    await ai('2026-11-18 15:00:00');
    await recorder.increment({ tenantId: A, featureKey: 'offer_story', kind: 'ACTION', at: new Date('2026-11-18T15:00:00Z') });
    await recorder.increment({ tenantId: A, featureKey: 'chat_send', kind: 'ACTION', at: new Date('2026-11-19T00:30:00Z') });
    // 19/11 em Brasília (00:30 UTC do dia 20 ainda é 19)
    await ai('2026-11-19 15:00:00');
    await recorder.increment({ tenantId: A, featureKey: 'offer_story', kind: 'ACTION', at: new Date('2026-11-19T15:00:00Z') });
    await recorder.increment({ tenantId: A, featureKey: 'chat_send', kind: 'ACTION', at: new Date('2026-11-20T00:30:00Z') });

    const live = mine((await new PrismaLiveFeatureUsageReader(prisma).read(window())).rows);
    expect(live.map((r) => [r.day, r.featureKey, r.uses])).toEqual([['2026-11-18', 'offer_story', 1]]);

    const daily = mine((await new PrismaDailyFeatureUsageReader(prisma).read(window())).rows);
    expect(daily.map((r) => [r.day, r.featureKey, r.kind, r.uses]).sort()).toEqual([
      ['2026-11-19', 'chat_send', 'ACTION', 1],
      ['2026-11-19', 'offer_story', 'ACTION', 1],
    ]);
  });
});
