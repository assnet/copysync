import { Prisma, type PrismaClient } from '@prisma/client';
import { limitKeyOfChannel } from '../../../tenants/domain/channelLimits';
import type { TenantSessionHourSample } from '../../domain/contracts/IInfraCostSnapshotRepository';
import type { IInfraTenantUsageReader } from '../../domain/contracts/IInfraTenantUsageReader';
import { effectiveTenantContractedSessions } from '../../domain/services/infraCostCalculator';

const STATEMENT_TIMEOUT = '2s';
/** Relógio do lease: `timestamp` sem fuso gravado em UTC (mesmo de `PrismaWorkerCapacityReader`). */
const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
const WA_KEY = limitKeyOfChannel('sessions', 'whatsapp');
const TG_KEY = limitKeyOfChannel('sessions', 'telegram');
/** Mesmo texto numérico aceito por `PrismaWorkerCapacityReader` (o resto = ilimitado). */
const NUMERIC_TEXT = '^\\s*[0-9]{1,9}(\\.[0-9]+)?\\s*$';

interface TenantSqlRow {
  tenantId: string;
  planSlug: string | null;
  wa: number | null;
  tg: number | null;
  connected: number;
}

/**
 * Foto por tenant `ACTIVE` (T13): conectadas (`CONNECTED` + dono + lease vivo, não apagada) e limites de
 * sessão por canal com a regra numérica do `PrismaWorkerCapacityReader`; o ilimitado vira preset do plano
 * aqui (`effectiveTenantContractedSessions`). Uma consulta com `statement_timeout` de 2 s. Só o job usa.
 */
export class PrismaInfraTenantUsageReader implements IInfraTenantUsageReader {
  constructor(private readonly prisma: PrismaClient) {}

  async readHour(): Promise<TenantSessionHourSample[]> {
    const p = this.prisma;
    const [, rows] = await p.$transaction([
      p.$executeRawUnsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`),
      p.$queryRaw<TenantSqlRow[]>`
        WITH t AS (
          SELECT "id", "planSlug" FROM "tenants" WHERE "status" = 'ACTIVE'
        ),
        e AS (
          SELECT te."tenantId", te."key",
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
          SELECT x."tenantId", COUNT(*)::int AS connected
          FROM "sessions" x
          JOIN t ON t."id" = x."tenantId"
          WHERE x."deletedAt" IS NULL AND x."status" = 'CONNECTED'
            AND x."ownerWorkerId" IS NOT NULL AND x."leaseUntil" > ${NOW}
          GROUP BY x."tenantId"
        )
        SELECT t."id" AS "tenantId", t."planSlug", lim.wa, lim.tg, COALESCE(s.connected, 0)::int AS connected
        FROM t
        LEFT JOIN lim ON lim."tenantId" = t."id"
        LEFT JOIN s ON s."tenantId" = t."id"
        ORDER BY t."id"`,
    ]);
    return rows.map((r) => ({
      tenantId: r.tenantId,
      planSlug: r.planSlug,
      connectedSessions: Number(r.connected),
      contractedSessions: Math.round(effectiveTenantContractedSessions(r.planSlug, {
        whatsapp: r.wa === null ? null : Number(r.wa),
        telegram: r.tg === null ? null : Number(r.tg),
      })),
    }));
  }
}
