import { Prisma } from '@prisma/client';
import { UsageMetricsReadUnavailableError } from '../../../../shared/errors/internal/UsageMetricsErrors';
import type { FeatureUsageReadInput, FeatureUsageReadResult, IFeatureUsageReader } from '../../domain/contracts/IFeatureUsageReader';
import type { UsageReadBudget } from '../../domain/contracts/IUsageReadGate';
import type { FeatureUsageRow } from '../../domain/services/aggregateFeatureUsage';
import {
  FEATURE_USAGE_CATALOG,
  findFeature,
  sourceOn,
  type FeatureUsageKey,
  type FeatureUsageKind,
} from '../../domain/services/featureUsageCatalog';
import { dayInZone } from '../../domain/services/featureUsagePeriod';
import {
  inPeriod,
  offerDispatchesPeriodSql,
  offersPeriodSql,
  usageDay,
  type DispatchPeriodRow,
  type OfferPeriodRow,
} from './featureUsagePeriodSql';
import { runWithinBudget, type UsageReadPrisma } from './featureUsageReadTimeout';

/** Guarda de volume do leitor sob demanda (design §6, D3). */
export const LIVE_USAGE_ROW_GUARD = 100_000;

/** Linha crua de uso: dia em texto, contagem `int`, classificação opcional (`cls`). */
type RawUsageRow = { day: string; tenantId: string; cls?: string | null; uses: number };
type Classified = { featureKey: FeatureUsageKey; kind: FeatureUsageKind } | null;

export interface FeatureUsageSourceQuery {
  /** Tabela lida (uma instrução por fonte). */
  table: string;
  keys: readonly FeatureUsageKey[];
  sql(from: Date, toExclusive: Date): Prisma.Sql;
  classify(row: RawUsageRow): Classified;
}

const fixed = (featureKey: FeatureUsageKey, kind: FeatureUsageKind) => (): Classified => ({ featureKey, kind });

const AUDIT_ACTION_KEYS: Readonly<Record<string, FeatureUsageKey>> = {
  AFFILIATE_CREDENTIAL_UPSERTED: 'affiliate_credentials',
  AFFILIATE_SESSION_SYNCED: 'extension_sync',
  SAVER_EXPORTED: 'saver_export',
};

/**
 * As onze fontes da P1 (design §4.1). Período e dia sempre pelas funções de `featureUsagePeriodSql.ts`
 * (instante UTC explícito, dia de Brasília em texto). Toda consulta agrupa por dia e `"tenantId"`; nenhuma lê conteúdo.
 */
export const FEATURE_USAGE_SOURCES: readonly FeatureUsageSourceQuery[] = [
  {
    table: 'offers',
    keys: ['offer_generator', 'group_monitoring'],
    sql: offersPeriodSql,
    // A oferta `HUNTER` não é criação de recurso (fica fora do `WHERE`); a execução conta em `offer_hunter`.
    classify: (r) => {
      const origin = (r as unknown as OfferPeriodRow).origin;
      if (origin === 'GENERATOR') return { featureKey: 'offer_generator', kind: 'ACTION' };
      if (origin === 'MONITORING') return { featureKey: 'group_monitoring', kind: 'AUTOMATIC' };
      return null;
    },
  },
  {
    table: 'offer_dispatches',
    keys: ['offer_dispatch'],
    sql: offerDispatchesPeriodSql,
    classify: fixed('offer_dispatch', 'AUTOMATIC'), // D11: tipo fixo
  },
  {
    table: 'offer_hunt_runs',
    keys: ['offer_hunter'],
    sql: (from, to) => Prisma.sql`
      SELECT ${usageDay('"startedAt"')} AS day, "tenantId", "trigger"::text AS cls, count(*)::int AS uses
      FROM "offer_hunt_runs"
      WHERE "status" <> 'SKIPPED' AND ${inPeriod('"startedAt"', from, to)}
      GROUP BY day, "tenantId", "trigger"`,
    classify: (r) => ({ featureKey: 'offer_hunter', kind: r.cls === 'SCHEDULED' ? 'AUTOMATIC' : 'ACTION' }),
  },
  {
    table: 'ai_usage_logs',
    keys: ['ai_rewrite', 'offer_story'],
    sql: (from, to) => Prisma.sql`
      SELECT ${usageDay('"createdAt"')} AS day, "tenantId", "purpose" AS cls, count(*)::int AS uses
      FROM "ai_usage_logs"
      WHERE "success" = true AND "purpose" IN ('offer.text', 'offer_story_headline') AND ${inPeriod('"createdAt"', from, to)}
      GROUP BY day, "tenantId", "purpose"`,
    classify: (r) => {
      if (r.cls === 'offer.text') return { featureKey: 'ai_rewrite', kind: 'AUTOMATIC' }; // D11
      if (r.cls === 'offer_story_headline') return { featureKey: 'offer_story', kind: 'ACTION' };
      return null;
    },
  },
  {
    table: 'link_rotations',
    keys: ['link_rotation'],
    sql: (from, to) => Prisma.sql`
      SELECT ${usageDay('"createdAt"')} AS day, "tenantId", count(*)::int AS uses
      FROM "link_rotations"
      WHERE ${inPeriod('"createdAt"', from, to)}
      GROUP BY day, "tenantId"`,
    classify: fixed('link_rotation', 'ACTION'),
  },
  {
    table: 'link_clicks',
    keys: ['link_rotation_click'],
    sql: (from, to) => Prisma.sql`
      SELECT ${usageDay('"createdAt"')} AS day, "tenantId", count(*)::int AS uses
      FROM "link_clicks"
      WHERE ${inPeriod('"createdAt"', from, to)}
      GROUP BY day, "tenantId"`,
    classify: fixed('link_rotation_click', 'AUDIENCE'),
  },
  {
    table: 'storefront_offers',
    keys: ['storefront'],
    sql: (from, to) => Prisma.sql`
      SELECT ${usageDay('"createdAt"')} AS day, "tenantId", count(*)::int AS uses
      FROM "storefront_offers"
      WHERE "status" IN ('DRAFT', 'PUBLISHED') AND ${inPeriod('"createdAt"', from, to)}
      GROUP BY day, "tenantId"`,
    classify: fixed('storefront', 'ACTION'),
  },
  {
    table: 'sessions',
    keys: ['whatsapp_session', 'telegram_session'],
    // Regra de `channelForEngine`: só `telegram` é Telegram; engine desconhecida conta como WhatsApp. Inclui removidas.
    sql: (from, to) => Prisma.sql`
      SELECT ${usageDay('"createdAt"')} AS day, "tenantId",
             CASE WHEN "engine" = 'telegram' THEN 'telegram' ELSE 'whatsapp' END AS cls, count(*)::int AS uses
      FROM "sessions"
      WHERE ${inPeriod('"createdAt"', from, to)}
      GROUP BY day, "tenantId", cls`,
    classify: (r) => ({ featureKey: r.cls === 'telegram' ? 'telegram_session' : 'whatsapp_session', kind: 'ACTION' }),
  },
  {
    table: 'saver_extractions',
    keys: ['saver_extraction'],
    sql: (from, to) => Prisma.sql`
      SELECT ${usageDay('"createdAt"')} AS day, "tenantId", count(*)::int AS uses
      FROM "saver_extractions"
      WHERE ${inPeriod('"createdAt"', from, to)}
      GROUP BY day, "tenantId"`,
    classify: fixed('saver_extraction', 'ACTION'),
  },
  {
    table: 'audit_logs',
    keys: ['affiliate_credentials', 'extension_sync', 'saver_export'],
    // Única leitura de `meta`: o booleano `completed` de `SAVER_EXPORTED` (gravado também quando falha).
    sql: (from, to) => Prisma.sql`
      SELECT ${usageDay('"createdAt"')} AS day, "tenantId", "action"::text AS cls, count(*)::int AS uses
      FROM "audit_logs"
      WHERE "tenantId" IS NOT NULL
        AND ("action" IN ('AFFILIATE_CREDENTIAL_UPSERTED', 'AFFILIATE_SESSION_SYNCED')
             OR ("action" = 'SAVER_EXPORTED' AND meta->>'completed' = 'true'))
        AND ${inPeriod('"createdAt"', from, to)}
      GROUP BY day, "tenantId", "action"`,
    classify: (r) => {
      const featureKey = r.cls ? AUDIT_ACTION_KEYS[r.cls] : undefined;
      return featureKey ? { featureKey, kind: 'ACTION' } : null;
    },
  },
  {
    table: 'login_events',
    keys: ['panel_login'],
    // `userId` só faz o join para achar a conta; login de usuário em 2 contas conta nas 2.
    sql: (from, to) => Prisma.sql`
      SELECT ${usageDay('le."createdAt"')} AS day, ut."tenantId", count(*)::int AS uses
      FROM "login_events" le
      JOIN "user_tenants" ut ON ut."userId" = le."userId"
      WHERE le."type" IN ('LOGIN_OK', 'LOGIN_CODE_VERIFIED') AND le."userId" IS NOT NULL
        AND ${inPeriod('le."createdAt"', from, to)}
      GROUP BY day, ut."tenantId"`,
    classify: fixed('panel_login', 'ACCESS'),
  },
];

/** Primeiro dado de cada recurso: uma instrução, mesmo `WHERE` de classificação, sem período nem `GROUP BY`. */
export const FIRST_DATA_DAYS_SQL = Prisma.sql`
  SELECT 'offer_generator' AS key, MIN("createdAt") AS first FROM "offers" WHERE "origin" = 'GENERATOR'
  UNION ALL SELECT 'group_monitoring', MIN("createdAt") FROM "offers" WHERE "origin" = 'MONITORING'
  UNION ALL SELECT 'offer_dispatch', MIN("updatedAt") FROM "offer_dispatches" WHERE "status" = 'SENT'
  UNION ALL SELECT 'offer_hunter', MIN("startedAt") FROM "offer_hunt_runs" WHERE "status" <> 'SKIPPED'
  UNION ALL SELECT 'ai_rewrite', MIN("createdAt") FROM "ai_usage_logs" WHERE "success" AND "purpose" = 'offer.text'
  UNION ALL SELECT 'offer_story', MIN("createdAt") FROM "ai_usage_logs" WHERE "success" AND "purpose" = 'offer_story_headline'
  UNION ALL SELECT 'link_rotation', MIN("createdAt") FROM "link_rotations"
  UNION ALL SELECT 'link_rotation_click', MIN("createdAt") FROM "link_clicks"
  UNION ALL SELECT 'storefront', MIN("createdAt") FROM "storefront_offers" WHERE "status" IN ('DRAFT', 'PUBLISHED')
  UNION ALL SELECT 'whatsapp_session', MIN("createdAt") FROM "sessions" WHERE "engine" <> 'telegram'
  UNION ALL SELECT 'telegram_session', MIN("createdAt") FROM "sessions" WHERE "engine" = 'telegram'
  UNION ALL SELECT 'saver_extraction', MIN("createdAt") FROM "saver_extractions"
  UNION ALL SELECT 'affiliate_credentials', MIN("createdAt") FROM "audit_logs" WHERE "action" = 'AFFILIATE_CREDENTIAL_UPSERTED' AND "tenantId" IS NOT NULL
  UNION ALL SELECT 'extension_sync', MIN("createdAt") FROM "audit_logs" WHERE "action" = 'AFFILIATE_SESSION_SYNCED' AND "tenantId" IS NOT NULL
  UNION ALL SELECT 'saver_export', MIN("createdAt") FROM "audit_logs" WHERE "action" = 'SAVER_EXPORTED' AND "tenantId" IS NOT NULL AND meta->>'completed' = 'true'
  UNION ALL SELECT 'panel_login', MIN("createdAt") FROM "login_events" WHERE "type" IN ('LOGIN_OK', 'LOGIN_CODE_VERIFIED') AND "userId" IS NOT NULL`;

type FirstDataRow = { key: string; first: Date | null };

/** Mapper: contagem `int` → `number`, linha sempre por dia (`activeDays = 1`, `lastDay = day`). */
export function toFeatureUsageRow(raw: RawUsageRow, classified: NonNullable<Classified>): FeatureUsageRow {
  const day = String(raw.day);
  return {
    day,
    tenantId: raw.tenantId,
    featureKey: classified.featureKey,
    kind: classified.kind,
    uses: Number(raw.uses),
    activeDays: 1,
    lastDay: day,
  };
}

/**
 * Leitor sob demanda (P1): uma instrução por fonte, **em sequência** (nunca `Promise.all`), cada uma na
 * própria transação pelo orçamento do pedido; depois o primeiro dado, no mesmo orçamento.
 */
export class PrismaLiveFeatureUsageReader implements IFeatureUsageReader {
  constructor(private readonly prisma: UsageReadPrisma) {}

  async read(input: FeatureUsageReadInput): Promise<FeatureUsageReadResult> {
    const wanted = new Set<FeatureUsageKey>(input.featureKeys);
    const rows: FeatureUsageRow[] = [];
    for (const source of FEATURE_USAGE_SOURCES) {
      if (!source.keys.some((k) => wanted.has(k))) continue;
      const raw = await runWithinBudget<RawUsageRow>(input.budget, this.prisma, source.sql(input.from, input.toExclusive));
      for (const r of raw) {
        const classified = source.classify(r);
        if (!classified || !wanted.has(classified.featureKey)) continue;
        const feature = findFeature(classified.featureKey, FEATURE_USAGE_CATALOG);
        if (feature && sourceOn(feature, String(r.day)) !== 'LIVE') continue; // dia do contador (P2)
        rows.push(toFeatureUsageRow(r, classified));
      }
      if (rows.length > LIVE_USAGE_ROW_GUARD) throw new UsageMetricsReadUnavailableError();
    }
    return { rows, firstDataDay: await this.firstDataDays(wanted, input.budget) };
  }

  private async firstDataDays(
    wanted: ReadonlySet<FeatureUsageKey>,
    budget: UsageReadBudget,
  ): Promise<FeatureUsageReadResult['firstDataDay']> {
    const raw = await runWithinBudget<FirstDataRow>(budget, this.prisma, FIRST_DATA_DAYS_SQL);
    const out: FeatureUsageReadResult['firstDataDay'] = {};
    for (const key of wanted) out[key] = null;
    for (const r of raw) {
      const key = r.key as FeatureUsageKey;
      if (wanted.has(key)) out[key] = r.first ? dayInZone(new Date(r.first)) : null;
    }
    return out;
  }
}
