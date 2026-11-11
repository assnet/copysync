import { Prisma, type PrismaClient } from '@prisma/client';
import { limitKeyOfChannel } from '../../../tenants/domain/channelLimits';
import type { IWorkerCapacityReader, WorkerCapacityPlanRow } from '../../domain/contracts/IWorkerCapacityReader';

const STATEMENT_TIMEOUT = '2s';
/** Relógio do lease: `timestamp` sem fuso gravado em UTC (mesmo de `SessionsOccupancySource`). */
const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
const WA_KEY = limitKeyOfChannel('sessions', 'whatsapp');
const TG_KEY = limitKeyOfChannel('sessions', 'telegram');
/**
 * String numérica aceita: só decimal simples sem sinal (até 9 dígitos inteiros, com espaços). Hex,
 * notação científica, sinal e o resto contam como ilimitado aqui — diferente de
 * `PrismaEntitlementReader.toNumber`, que aceita esses formatos. Os valores são gravados por
 * `syncPlanEntitlements` como número JSON; a regra estreita evita que `'1e400'` estoure o `::float8`
 * ("value out of range") e derrube a rota inteira.
 */
const NUMERIC_TEXT = '^\\s*[0-9]{1,9}(\\.[0-9]+)?\\s*$';

interface PlanSqlRow {
  planSlug: string | null;
  tenants: number;
  contracted_wa: number;
  contracted_tg: number;
  unlimited_wa: number;
  unlimited_tg: number;
  created_wa: number;
  created_tg: number;
  connected_wa: number;
  connected_tg: number;
}

/**
 * Agregado por plano (WSCALE-09) numa consulta, com `statement_timeout` de 2 s na transação.
 * Valor efetivo = linha de `tenant_entitlements` (o preset do plano é copiado para ela no sync de
 * billing; o runtime não cai no preset): ausente, JSON `null` ou não numérico = ilimitado, igual a
 * `CreateSessionUseCase`. Canal = engine (`telegram` → Telegram, resto → WhatsApp). Planos com preset
 * e sem tenant `ACTIVE` saem zerados. Só leitura, sem dado de tenant individual.
 */
export class PrismaWorkerCapacityReader implements IWorkerCapacityReader {
  constructor(private readonly prisma: PrismaClient) {}

  async readByPlan(): Promise<WorkerCapacityPlanRow[]> {
    const p = this.prisma;
    const [, rows] = await p.$transaction([
      p.$executeRawUnsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`),
      p.$queryRaw<PlanSqlRow[]>`
        WITH t AS (
          SELECT "id", "planSlug" FROM "tenants" WHERE "status" = 'ACTIVE'
        ),
        e AS (
          SELECT te."tenantId", te."key",
            -- Número JSON é sempre limite. Estouro de float8 é improvável: JSON.parse de ≥1e308 vira
            -- Infinity e é gravado como null (não chega aqui como número).
            CASE
              WHEN jsonb_typeof(te."value") = 'number' THEN (te."value" #>> '{}')::float8
              WHEN jsonb_typeof(te."value") = 'string' AND (te."value" #>> '{}') ~ ${NUMERIC_TEXT}
                THEN (te."value" #>> '{}')::float8
            END AS n
          FROM "tenant_entitlements" te
          JOIN t ON t."id" = te."tenantId"
          WHERE te."key" IN (${WA_KEY}, ${TG_KEY})
        ),
        lim AS (
          SELECT "tenantId",
            MAX(n) FILTER (WHERE "key" = ${WA_KEY}) AS wa,
            MAX(n) FILTER (WHERE "key" = ${TG_KEY}) AS tg
          FROM e GROUP BY "tenantId"
        ),
        s AS (
          SELECT s."tenantId",
            COUNT(*) FILTER (WHERE s."engine" IS DISTINCT FROM 'telegram') AS created_wa,
            COUNT(*) FILTER (WHERE s."engine" = 'telegram') AS created_tg,
            COUNT(*) FILTER (WHERE s."engine" IS DISTINCT FROM 'telegram' AND live) AS connected_wa,
            COUNT(*) FILTER (WHERE s."engine" = 'telegram' AND live) AS connected_tg
          FROM (
            SELECT x."tenantId", x."engine",
              (x."status" = 'CONNECTED' AND x."ownerWorkerId" IS NOT NULL AND x."leaseUntil" > ${NOW}) AS live
            FROM "sessions" x
            JOIN t ON t."id" = x."tenantId"
            WHERE x."deletedAt" IS NULL
          ) s
          GROUP BY s."tenantId"
        )
        SELECT t."planSlug",
          COUNT(*)::int AS tenants,
          COALESCE(SUM(lim.wa), 0)::float8 AS contracted_wa,
          COALESCE(SUM(lim.tg), 0)::float8 AS contracted_tg,
          COUNT(*) FILTER (WHERE lim.wa IS NULL)::int AS unlimited_wa,
          COUNT(*) FILTER (WHERE lim.tg IS NULL)::int AS unlimited_tg,
          COALESCE(SUM(s.created_wa), 0)::int AS created_wa,
          COALESCE(SUM(s.created_tg), 0)::int AS created_tg,
          COALESCE(SUM(s.connected_wa), 0)::int AS connected_wa,
          COALESCE(SUM(s.connected_tg), 0)::int AS connected_tg
        FROM t
        LEFT JOIN lim ON lim."tenantId" = t."id"
        LEFT JOIN s ON s."tenantId" = t."id"
        GROUP BY t."planSlug"
        UNION ALL
        SELECT DISTINCT pp."planSlug", 0, 0, 0, 0, 0, 0, 0, 0, 0
        FROM "plan_entitlement_presets" pp
        WHERE NOT EXISTS (SELECT 1 FROM t WHERE t."planSlug" = pp."planSlug")
        ORDER BY 1 NULLS LAST`,
    ]);
    return rows.map((r) => ({
      planSlug: r.planSlug,
      tenants: Number(r.tenants),
      contracted: { whatsapp: Number(r.contracted_wa), telegram: Number(r.contracted_tg) },
      unlimitedTenants: { whatsapp: Number(r.unlimited_wa), telegram: Number(r.unlimited_tg) },
      created: { whatsapp: Number(r.created_wa), telegram: Number(r.created_tg) },
      connected: { whatsapp: Number(r.connected_wa), telegram: Number(r.connected_tg) },
    }));
  }
}
