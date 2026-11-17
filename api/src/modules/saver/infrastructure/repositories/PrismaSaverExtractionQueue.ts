import type { PrismaClient, SaverExtractionItem as PrismaSaverExtractionItem } from '@prisma/client';
import type { SaverExtraction, SaverExtractionItem } from '../../domain/entities/SaverEntities';
import type {
  EnqueueSaverExtractionInput,
  ISaverExtractionQueue,
  ReleaseSaverItemInput,
} from '../../domain/contracts/ISaverExtractionQueue';
import { SaverExtractionItemStatus, SaverExtractionStatus } from '../../domain/enums/SaverEnums';
import { PrismaSaverMapper } from '../mappers/PrismaSaverMapper';

type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Fila do Saver em tabela (sem Redis). `claimNext` é uma instrução (`UPDATE … WHERE id = (SELECT … FOR UPDATE
 * SKIP LOCKED LIMIT 1)`) e só pega item de sessão com lease vivo DESTE processo e sem `deletedAt`
 * (exclusão lógica: FK não dispara). Item RUNNING com trava vencida volta a concorrer.
 */
export class PrismaSaverExtractionQueue implements ISaverExtractionQueue {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly workerId: string,
  ) {}

  /** Extração + itens numa transação; grupo já pendente fica fora (índice único parcial). Sem item = CANCELLED. */
  async enqueue(input: EnqueueSaverExtractionInput): Promise<SaverExtraction> {
    const row = await this.prisma.$transaction(async (tx) => {
      const extraction = await tx.saverExtraction.create({
        data: {
          tenantId: input.tenantId,
          sessionId: input.sessionId,
          requestedByUserId: input.requestedByUserId,
          trigger: input.trigger,
          status: SaverExtractionStatus.QUEUED,
          createdAt: input.now,
        },
      });
      const groupIds = [...new Set(input.groupIds)].sort();
      const total =
        groupIds.length === 0
          ? 0
          : await tx.$executeRaw`
        INSERT INTO "saver_extraction_items"
          ("id", "extractionId", "tenantId", "sessionId", "groupId", "status", "nextAttemptAt", "createdAt")
        SELECT gen_random_uuid()::text, ${extraction.id}, g."tenantId", ${input.sessionId}, g."id", 'QUEUED', ${input.now}, ${input.now}
        FROM "saver_groups" g
        WHERE g."tenantId" = ${input.tenantId} AND g."id" = ANY(${groupIds}::text[]) AND g."removedAt" IS NULL
        ORDER BY g."id"
        ON CONFLICT ("groupId") WHERE "status" IN ('QUEUED', 'RUNNING') DO NOTHING`;
      return tx.saverExtraction.update({
        where: { id: extraction.id },
        data:
          total > 0
            ? { totalGroups: total }
            : { status: SaverExtractionStatus.CANCELLED, finishedAt: input.now },
      });
    });
    return PrismaSaverMapper.extraction(row);
  }

  async claimNext(sessionId: string, now: Date, lockUntil: Date): Promise<SaverExtractionItem | null> {
    const rows = await this.prisma.$queryRaw<PrismaSaverExtractionItem[]>`
      UPDATE "saver_extraction_items" SET "status" = 'RUNNING', "lockedUntil" = ${lockUntil}
      WHERE "id" = (
        SELECT i."id" FROM "saver_extraction_items" i
        JOIN "sessions" s ON s."id" = i."sessionId"
        WHERE i."sessionId" = ${sessionId}
          AND s."deletedAt" IS NULL
          AND s."ownerWorkerId" = ${this.workerId} AND s."leaseUntil" > (now() AT TIME ZONE 'UTC')
          AND ((i."status" = 'QUEUED' AND i."nextAttemptAt" <= ${now})
            OR (i."status" = 'RUNNING' AND (i."lockedUntil" IS NULL OR i."lockedUntil" <= ${now})))
        ORDER BY i."nextAttemptAt", i."id"
        FOR UPDATE OF i SKIP LOCKED
        LIMIT 1)
      RETURNING *`;
    const row = rows[0];
    if (!row) return null;
    await this.prisma.saverExtraction.updateMany({
      where: { id: row.extractionId, status: SaverExtractionStatus.QUEUED },
      data: { status: SaverExtractionStatus.RUNNING },
    });
    return PrismaSaverMapper.item(row);
  }

  async release(input: ReleaseSaverItemInput): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Só o dono do claim grava: item cancelado ou retomado por outro claim fica como está.
      const { count } = await tx.saverExtractionItem.updateMany({
        where: { id: input.itemId, status: SaverExtractionItemStatus.RUNNING, lockedUntil: input.claimedLockUntil },
        data: {
          status: input.status,
          attempts: input.attempts,
          nextAttemptAt: input.nextAttemptAt,
          errorCode: input.errorCode,
          finishedAt: input.finishedAt,
          lockedUntil: null,
        },
      });
      if (count === 0) return false;
      const item = await tx.saverExtractionItem.findUniqueOrThrow({
        where: { id: input.itemId },
        select: { extractionId: true },
      });
      await tx.saverExtraction.update({
        where: { id: item.extractionId },
        data: {
          membersFound: { increment: input.membersFound ?? 0 },
          newContacts: { increment: input.newContacts ?? 0 },
          doneGroups: { increment: input.status === SaverExtractionItemStatus.DONE ? 1 : 0 },
          failedGroups: { increment: input.status === SaverExtractionItemStatus.FAILED ? 1 : 0 },
        },
      });
      await closeExtractions(tx, input.finishedAt ?? input.nextAttemptAt, item.extractionId);
      return true;
    });
  }

  async findExtraction(tenantId: string, extractionId: string): Promise<SaverExtraction | null> {
    const row = await this.prisma.saverExtraction.findFirst({ where: { id: extractionId, tenantId } });
    return row ? PrismaSaverMapper.extraction(row) : null;
  }

  async cancelQueued(tenantId: string, extractionId: string, now: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.saverExtractionItem.updateMany({
        where: { tenantId, extractionId, status: SaverExtractionItemStatus.QUEUED },
        data: { status: SaverExtractionItemStatus.CANCELLED, finishedAt: now },
      });
      await closeExtractions(tx, now, extractionId, tenantId);
      return count;
    });
  }

  cancelPendingByGroup(tenantId: string, groupId: string, now: Date): Promise<number> {
    return this.cancelPending({ tenantId, groupId }, now);
  }

  cancelPendingByTenant(tenantId: string, now: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.$executeRaw`
        UPDATE "saver_extraction_items" i SET "status" = 'CANCELLED', "finishedAt" = ${now}, "lockedUntil" = NULL
        FROM "saver_extractions" e
        LEFT JOIN "users" u ON u."id" = e."requestedByUserId"
        WHERE e."id" = i."extractionId" AND i."tenantId" = ${tenantId}
          AND i."status" IN ('QUEUED', 'RUNNING') AND COALESCE(u."isSuperAdmin", false) = false`;
      if (count > 0) await closeExtractions(tx, now, undefined, tenantId);
      return count;
    });
  }

  async requestedBySuperAdmin(extractionId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM "saver_extractions" e JOIN "users" u ON u."id" = e."requestedByUserId"
        WHERE e."id" = ${extractionId} AND u."isSuperAdmin" = true) AS ok`;
    return rows[0]?.ok === true;
  }

  cancelPendingForDeletedSessions(now: Date): Promise<number> {
    return this.cancelPending({ session: { deletedAt: { not: null } } }, now);
  }

  /** Itens não cancelados criados desde `since` (cada um é uma leitura de grupo pedida). */
  countScansSince(tenantId: string, since: Date): Promise<number> {
    return this.prisma.saverExtractionItem.count({
      where: { tenantId, createdAt: { gte: since }, status: { not: SaverExtractionItemStatus.CANCELLED } },
    });
  }

  closeFinished(now: Date): Promise<number> {
    return this.prisma.$transaction((tx) => closeExtractions(tx, now));
  }

  private async cancelPending(
    where: { tenantId?: string; groupId?: string; session?: { deletedAt: { not: null } } },
    now: Date,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.saverExtractionItem.updateMany({
        where: { ...where, status: { in: [SaverExtractionItemStatus.QUEUED, SaverExtractionItemStatus.RUNNING] } },
        data: { status: SaverExtractionItemStatus.CANCELLED, finishedAt: now, lockedUntil: null },
      });
      if (count > 0) await closeExtractions(tx, now, undefined, where.tenantId);
      return count;
    });
  }
}

/**
 * Fecha extrações abertas sem item pendente: todos DONE → DONE; algum DONE → PARTIAL; algum FAILED →
 * FAILED; senão CANCELLED. Filtro opcional por extração/tenant; sem filtro varre as abertas (manutenção).
 */
async function closeExtractions(tx: TxClient, now: Date, extractionId?: string, tenantId?: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE "saver_extractions" e SET
      "status" = CASE
        WHEN agg.done = agg.total AND agg.total > 0 THEN 'DONE'
        WHEN agg.done > 0 THEN 'PARTIAL'
        WHEN agg.failed > 0 THEN 'FAILED'
        ELSE 'CANCELLED' END,
      "finishedAt" = ${now}
    FROM (
      SELECT x."id",
        COUNT(i."id") AS total,
        COUNT(i."id") FILTER (WHERE i."status" = 'DONE') AS done,
        COUNT(i."id") FILTER (WHERE i."status" = 'FAILED') AS failed,
        COUNT(i."id") FILTER (WHERE i."status" IN ('QUEUED', 'RUNNING')) AS pending
      FROM "saver_extractions" x
      LEFT JOIN "saver_extraction_items" i ON i."extractionId" = x."id"
      WHERE x."status" IN ('QUEUED', 'RUNNING')
        AND (${extractionId ?? null}::text IS NULL OR x."id" = ${extractionId ?? null})
        AND (${tenantId ?? null}::text IS NULL OR x."tenantId" = ${tenantId ?? null})
      GROUP BY x."id"
    ) agg
    WHERE e."id" = agg."id" AND agg.pending = 0`;
}
