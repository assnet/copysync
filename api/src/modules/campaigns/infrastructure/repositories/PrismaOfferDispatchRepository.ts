import type { PrismaClient } from '@prisma/client';
import type {
  IOfferDispatchRepository,
  NewOfferDispatchItem,
  OfferDispatchResult,
} from '../../domain/contracts/IOfferDispatchRepository';
import type { OfferDispatch } from '../../domain/entities/OfferDispatch';
import { OFFER_DISPATCH_STATUSES, type OfferDispatchStatus } from '../../domain/enums/OfferDispatchStatus';
import { PrismaOfferDispatchMapper as Mapper, type OfferDispatchRawRow } from '../mappers/PrismaOfferDispatchMapper';

export class PrismaOfferDispatchRepository implements IOfferDispatchRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Transição da oferta + criação dos envios na mesma transação: sem oferta SENDING órfã nem
   * envio de oferta ainda editável. Só DRAFT: oferta FAILED não reenvia (reenvio = nova oferta, P2).
   */
  async startSending(
    offerId: string,
    tenantId: string,
    items: NewOfferDispatchItem[],
  ): Promise<OfferDispatch[] | null> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.offer.updateMany({
        where: { id: offerId, tenantId, status: 'DRAFT' },
        data: { status: 'SENDING' },
      });
      if (count === 0) return null;
      if (items.length === 0) return [];
      const rows = await tx.offerDispatch.createManyAndReturn({
        data: items.map((i) => ({
          tenantId,
          offerId,
          conversationId: i.conversationId,
          notBefore: i.notBefore,
          status: 'QUEUED' as const,
        })),
        skipDuplicates: true,
      });
      return rows.map(Mapper.toDomain);
    });
  }

  async listByOffer(offerId: string, tenantId: string): Promise<OfferDispatch[]> {
    const rows = await this.prisma.offerDispatch.findMany({
      where: { offerId, tenantId },
      orderBy: { notBefore: 'asc' },
    });
    return rows.map(Mapper.toDomain);
  }

  /**
   * CROSS-TENANT por design: o worker drena a fila de todos os tenants. Cada envio carrega
   * `tenantId`, e todo passo seguinte (envio, markResult) volta a filtrar por ele.
   * SKIP LOCKED deixa várias instâncias reivindicarem lotes disjuntos. `gen_random_uuid()`
   * (nativo no PG ≥ 13) é volátil: um token por linha.
   */
  async claimDue(now: Date, limit: number): Promise<OfferDispatch[]> {
    if (limit <= 0) return [];
    const rows = await this.prisma.$queryRaw<OfferDispatchRawRow[]>`
      UPDATE "offer_dispatches"
         SET "status" = 'SENDING'::"OfferDispatchStatus", "claimedAt" = now(),
             "claimToken" = gen_random_uuid()::text, "updatedAt" = now()
       WHERE "id" IN (
         SELECT "id" FROM "offer_dispatches"
          WHERE "status" = 'QUEUED'::"OfferDispatchStatus" AND "notBefore" <= ${now}
          ORDER BY "notBefore"
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING *`;
    return rows.map(Mapper.fromRawRow);
  }

  /** Token é único por claim: dispensa tenantId aqui (o envio seguinte filtra por ele). */
  async touchClaim(id: string, claimToken: string): Promise<boolean> {
    const { count } = await this.prisma.offerDispatch.updateMany({
      where: { id, claimToken, status: 'SENDING' },
      data: { claimedAt: new Date() },
    });
    return count > 0;
  }

  /**
   * CROSS-TENANT por design (worker): devolve à fila envios de worker que morreu no meio.
   * Com `chatMessageId` a mensagem já existe no chat: não volta (evita envio duplo).
   */
  async releaseStale(olderThan: Date): Promise<number> {
    const { count } = await this.prisma.offerDispatch.updateMany({
      where: { status: 'SENDING', claimedAt: { lt: olderThan }, chatMessageId: null },
      data: { status: 'QUEUED', claimedAt: null, claimToken: null },
    });
    return count;
  }

  /** Só SENDING com o token da posse: envio devolvido à fila e reivindicado por outro não é sobrescrito. */
  async markResult(id: string, tenantId: string, claimToken: string, result: OfferDispatchResult): Promise<boolean> {
    const data =
      result.status === 'SENT'
        ? { status: result.status, chatMessageId: result.chatMessageId, failureReason: null }
        : { status: result.status, failureReason: result.failureReason };
    const { count } = await this.prisma.offerDispatch.updateMany({
      where: { id, tenantId, claimToken, status: 'SENDING' },
      data,
    });
    return count > 0;
  }

  /** CROSS-TENANT por design (varredura do worker): ofertas SENDING sem envio aberto. */
  async findSendingWithoutOpenDispatches(limit: number): Promise<{ id: string; tenantId: string }[]> {
    if (limit <= 0) return [];
    return this.prisma.offer.findMany({
      where: { status: 'SENDING', dispatches: { none: { status: { in: ['QUEUED', 'SENDING'] } } } },
      select: { id: true, tenantId: true },
      take: limit,
    });
  }

  async countOpen(offerId: string, tenantId: string): Promise<number> {
    return this.prisma.offerDispatch.count({
      where: { offerId, tenantId, status: { in: ['QUEUED', 'SENDING'] } },
    });
  }

  async countByStatus(offerId: string, tenantId: string): Promise<Record<OfferDispatchStatus, number>> {
    const groups = await this.prisma.offerDispatch.groupBy({
      by: ['status'],
      where: { offerId, tenantId },
      _count: { _all: true },
    });
    const out = Object.fromEntries(OFFER_DISPATCH_STATUSES.map((s) => [s, 0])) as Record<OfferDispatchStatus, number>;
    for (const g of groups) out[g.status] = g._count._all;
    return out;
  }
}
