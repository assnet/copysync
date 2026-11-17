import { Prisma } from '@prisma/client';

/**
 * SQL das leituras de uso por período (design §4.1). As colunas de data são `timestamp(3)` sem fuso,
 * gravadas em UTC, por isso:
 * - o período compara a coluna crua com o instante UTC explícito (independe do `TimeZone` da sessão e usa índice);
 * - o dia é o de Brasília, pela forma única com dois `AT TIME ZONE`, devolvido como **texto** (`date` cru
 *   voltaria do Prisma como `Date` à meia-noite UTC).
 * Contagem sempre `count(*)::int` (sem o cast o `$queryRaw` devolve `BigInt`).
 */

/** Instante → `timestamp` sem fuso em UTC, explícito. */
export const utcInstant = (at: Date): Prisma.Sql => Prisma.sql`(${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** Dia de Brasília `YYYY-MM-DD` (texto) da coluna `timestamp` sem fuso. `column` é identificador fixo do código. */
export const usageDay = (column: string): Prisma.Sql =>
  Prisma.raw(`to_char(((${column} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD')`);

/** Filtro de período `[from, toExclusive)` sobre a coluna crua. */
export const inPeriod = (column: string, from: Date, toExclusive: Date): Prisma.Sql =>
  Prisma.sql`${Prisma.raw(column)} >= ${utcInstant(from)} AND ${Prisma.raw(column)} < ${utcInstant(toExclusive)}`;

export interface OfferPeriodRow {
  day: string;
  tenantId: string;
  origin: 'GENERATOR' | 'MONITORING';
  uses: number;
}

export interface DispatchPeriodRow {
  day: string;
  tenantId: string;
  uses: number;
}

/** Ofertas criadas no gerador e no monitoramento (a `HUNTER` não é criação de recurso). Índice `offers(createdAt)`. */
export const offersPeriodSql = (from: Date, toExclusive: Date): Prisma.Sql => Prisma.sql`
  SELECT ${usageDay('"createdAt"')} AS day, "tenantId", "origin"::text AS "origin", count(*)::int AS uses
  FROM "offers"
  WHERE "origin" IN ('GENERATOR', 'MONITORING') AND ${inPeriod('"createdAt"', from, toExclusive)}
  GROUP BY day, "tenantId", "origin"`;

/** Envios concluídos, de qualquer origem, pela hora do envio (`updatedAt`, S1). Índice `offer_dispatches(status, updatedAt)`. */
export const offerDispatchesPeriodSql = (from: Date, toExclusive: Date): Prisma.Sql => Prisma.sql`
  SELECT ${usageDay('"updatedAt"')} AS day, "tenantId", count(*)::int AS uses
  FROM "offer_dispatches"
  WHERE "status" = 'SENT' AND ${inPeriod('"updatedAt"', from, toExclusive)}
  GROUP BY day, "tenantId"`;
