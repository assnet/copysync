import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { RecordFeatureUsageUseCase } from '../../application/use-cases/RecordFeatureUsageUseCase';
import { RecordPageViewUseCase } from '../../application/use-cases/RecordPageViewUseCase';
import { FEATURE_USAGE_CATALOG } from '../../domain/services/featureUsageCatalog';
import { SCREEN_VIEW_KEYS } from '../../domain/services/screenViewCatalog';
import { PrismaDailyFeatureUsageReader } from './PrismaDailyFeatureUsageReader';
import { PrismaFeatureUsageDailyRepository } from './PrismaFeatureUsageDailyRepository';
import { PrismaPageViewReader, pageViewRankingSql } from './PrismaPageViewReader';
import { createReadBudget } from './featureUsageReadTimeout';

/**
 * Visitas de tela (P3) contra o Postgres descartável: gravação idempotente por dia × conta × tela pelo contador real
 * e ranking das telas agregado no SQL (uma linha por tela, sem `tenantId`), fora das linhas do resumo.
 */
const s = `pvr${Date.now().toString(36)}`;
const A = `${s}-ta`;
const B = `${s}-tb`;
const C = `${s}-tc`;
const BULK = Array.from({ length: 4 }, (_, i) => `${s}-bulk${i}`);
const run = (sql: string) => prisma.$executeRawUnsafe(sql);
const tenant = (t: string) => run(`INSERT INTO tenants (id, name, slug, "updatedAt") VALUES ('${t}', 'x', '${t}', now())`);
const daily = new PrismaFeatureUsageDailyRepository(prisma);
// Tela não tem corte: pedir corte aqui é erro (o contador engole e a gravação esperada falta)
const noCutover = { claimCutover: async (): Promise<string> => { throw new Error('screen has no cutover'); } };
const recorder = new RecordFeatureUsageUseCase({ daily, cutovers: noCutover });
const views = new PrismaPageViewReader(prisma);
const flush = () => new Promise((r) => setTimeout(r, 50));
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  for (const t of [A, B, C, ...BULK]) await tenant(t);
});

afterAll(async () => {
  await run(`DELETE FROM tenants WHERE id LIKE '${s}-%'`);
  await prisma.$disconnect();
});

const rowsOf = (tenantId: string) =>
  prisma.$queryRawUnsafe<{ featureKey: string; day: string; uses: number }[]>(
    `SELECT "featureKey", to_char(day, 'YYYY-MM-DD') AS day, uses FROM feature_usage_daily WHERE "tenantId" = '${tenantId}' ORDER BY day, "featureKey"`,
  );

describe('visitas de tela', () => {
  it('a mesma tela 5 vezes no dia grava uses = 1; outro dia de Brasília é outra linha', async () => {
    const useCase = new RecordPageViewUseCase({ recorder });
    for (let i = 0; i < 5; i++) useCase.execute({ tenantId: A, isSuperAdmin: false, key: 'view:offers', at: at('2026-11-20T15:00:00Z') });
    await flush();
    // 02:30 UTC do dia 21 ainda é dia 20 em Brasília
    useCase.execute({ tenantId: A, isSuperAdmin: false, key: 'view:offers', at: at('2026-11-21T02:30:00Z') });
    useCase.execute({ tenantId: A, isSuperAdmin: false, key: 'view:offers', at: at('2026-11-21T12:00:00Z') });
    useCase.execute({ tenantId: A, isSuperAdmin: true, key: 'view:dashboard', at: at('2026-11-21T12:00:00Z') });
    await flush();
    expect(await rowsOf(A)).toEqual([
      { featureKey: 'view:offers', day: '2026-11-20', uses: 1 },
      { featureKey: 'view:offers', day: '2026-11-21', uses: 1 },
    ]);
  });

  it('ranking: uma linha por tela com contas distintas e pares dia × conta, recorte por conta, sem tenantId', async () => {
    await daily.markOnce({ tenantId: B, featureKey: 'view:offers', kind: 'ACCESS', at: at('2026-11-20T15:00:00Z') });
    await daily.markOnce({ tenantId: B, featureKey: 'view:dashboard', kind: 'ACCESS', at: at('2026-11-20T15:00:00Z') });
    await daily.markOnce({ tenantId: C, featureKey: 'view:offers', kind: 'ACCESS', at: at('2026-11-20T15:00:00Z') });
    await daily.markOnce({ tenantId: C, featureKey: 'view:saver-groups', kind: 'ACCESS', at: at('2026-11-20T15:00:00Z') });

    const out = await views.read(
      {
        fromDay: '2026-11-20',
        toDayExclusive: '2026-11-22',
        scopes: [
          { keys: ['view:offers', 'view:dashboard'], tenantIds: [A, B] }, // C fora do recorte de Afiliados
          { keys: ['view:saver-groups'], tenantIds: [C] },
        ],
      },
      createReadBudget(),
    );
    const byKey = Object.fromEntries(out.rows.map((r) => [r.key, r]));
    expect(byKey['view:offers']).toEqual({ key: 'view:offers', tenants: 2, tenantDays: 3 });
    expect(byKey['view:dashboard']).toEqual({ key: 'view:dashboard', tenants: 1, tenantDays: 1 });
    expect(byKey['view:saver-groups']).toEqual({ key: 'view:saver-groups', tenants: 1, tenantDays: 1 });
    expect(out.rows).toHaveLength(3);
    expect(JSON.stringify(out)).not.toContain(s);
    expect(out.firstDataDay! <= '2026-11-20').toBe(true);

    // Período sem o dia 20: só a linha do dia 21 de A
    const later = await views.read({ fromDay: '2026-11-21', toDayExclusive: '2026-11-22', scopes: [{ keys: ['view:offers'], tenantIds: [A, B, C] }] }, createReadBudget());
    expect(later.rows).toEqual([{ key: 'view:offers', tenants: 1, tenantDays: 1 }]);
  });

  it('recorte vazio não consulta o ranking', () => {
    expect(pageViewRankingSql('2026-11-01', '2026-11-02', [{ keys: ['view:offers'], tenantIds: [] }])).toBeNull();
  });

  it('60 telas gravadas não mudam as linhas do resumo em memória (leitor diário pelo catálogo)', async () => {
    const reader = new PrismaDailyFeatureUsageReader(prisma);
    const input = () => ({
      from: at('2026-11-01T03:00:00Z'),
      toExclusive: at('2026-11-30T03:00:00Z'),
      granularity: 'day' as const,
      featureKeys: FEATURE_USAGE_CATALOG.map((f) => f.key),
      budget: createReadBudget(),
    });
    await daily.increment({ tenantId: A, featureKey: 'chat_send', kind: 'ACTION', at: at('2026-11-20T15:00:00Z') });
    const before = await reader.read(input());
    let written = 0;
    for (const t of BULK) {
      for (const key of SCREEN_VIEW_KEYS) {
        await daily.markOnce({ tenantId: t, featureKey: key, kind: 'ACCESS', at: at('2026-11-22T15:00:00Z') });
        written++;
      }
    }
    expect(written).toBe(60);
    const after = await reader.read(input());
    expect(after.rows.length).toBe(before.rows.length);
    expect(after.rows.some((r) => r.featureKey.startsWith('view:'))).toBe(false);
  });
});
