import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  CapturedOfferListItem, CapturedOfferResolution, ICapturedOfferRepository, NewCapturedOffer,
} from '../../domain/contracts/ICapturedOfferRepository';
import type { CapturedOffer, CapturedOfferReason, CapturedOfferStatus } from '../../domain/entities/CapturedOffer';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { OfferStatus } from '../../../campaigns/domain/enums/OfferStatus';
import type { MonitorTextMode } from '../../domain/entities/GroupMonitor';

type Row = Omit<CapturedOffer, 'status' | 'marketplace' | 'textSource'> & { status: string; marketplace: string | null; textSource: string | null };

function toDomain(r: Row): CapturedOffer {
  return {
    id: r.id, tenantId: r.tenantId, sessionId: r.sessionId, configId: r.configId, monitoredGroupId: r.monitoredGroupId,
    sourceExternalMessageId: r.sourceExternalMessageId, sourceText: r.sourceText, sourceMediaUrl: r.sourceMediaUrl,
    imageUnavailable: r.imageUnavailable, marketplace: r.marketplace as AffiliateProvider | null, sourceUrl: r.sourceUrl,
    affiliateUrl: r.affiliateUrl, coupon: r.coupon, finalText: r.finalText, status: r.status as CapturedOfferStatus,
    reason: r.reason, offerId: r.offerId, textSource: r.textSource as MonitorTextMode | null, aiErrorCode: r.aiErrorCode,
    startsAt: r.startsAt ? new Date(r.startsAt) : null, expiresAt: r.expiresAt ? new Date(r.expiresAt) : null,
    capturedAt: new Date(r.capturedAt), processedAt: r.processedAt ? new Date(r.processedAt) : null, claimToken: r.claimToken,
  };
}

const withGroup = { monitoredGroup: { select: { conversation: { select: { groupName: true, groupAvatarUrl: true } } } } } as const;

export class PrismaCapturedOfferRepository implements ICapturedOfferRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPending(input: NewCapturedOffer): Promise<boolean> {
    try {
      await this.prisma.capturedOffer.create({ data: { ...input, status: 'PENDING' } });
      return true;
    } catch (err) {
      // Mesma mensagem entregue de novo (reconexão, eco): unique (sessionId, sourceExternalMessageId)
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }
  }

  /**
   * CROSS-TENANT por design (worker): cada linha carrega `tenantId` e todo passo seguinte filtra
   * por ele. SKIP LOCKED deixa vários workers pegarem linhas disjuntas; PROCESSING antigo (worker
   * caiu) volta a ser reivindicado.
   */
  async claimPending(limit: number, staleBefore: Date): Promise<CapturedOffer[]> {
    if (limit <= 0) return [];
    const rows = await this.prisma.$queryRaw<Row[]>`
      UPDATE "captured_offers"
         SET "status" = 'PROCESSING'::"CapturedOfferStatus", "claimedAt" = now(),
             "claimToken" = gen_random_uuid()::text, "updatedAt" = now()
       WHERE "id" IN (
         SELECT "id" FROM "captured_offers"
          WHERE "status" = 'PENDING'::"CapturedOfferStatus"
             OR ("status" = 'PROCESSING'::"CapturedOfferStatus" AND "claimedAt" < ${staleBefore})
          ORDER BY "capturedAt"
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING *`;
    return rows.map(toDomain);
  }

  private async finish(id: string, claimToken: string, status: CapturedOfferStatus, data: Partial<CapturedOfferResolution> & { offerId?: string; reason: string | null }): Promise<boolean> {
    const { count } = await this.prisma.capturedOffer.updateMany({
      where: { id, claimToken, status: 'PROCESSING' },
      data: { ...data, status, processedAt: new Date() },
    });
    return count > 0;
  }

  markQueued(id: string, claimToken: string, data: CapturedOfferResolution & { offerId: string }): Promise<boolean> {
    return this.finish(id, claimToken, 'QUEUED', { ...data, reason: null });
  }

  markSkipped(id: string, claimToken: string, reason: CapturedOfferReason, data: Partial<CapturedOfferResolution> = {}): Promise<boolean> {
    return this.finish(id, claimToken, 'SKIPPED', { ...data, reason });
  }

  markFailed(id: string, claimToken: string, reason: CapturedOfferReason, data: Partial<CapturedOfferResolution> = {}): Promise<boolean> {
    return this.finish(id, claimToken, 'FAILED', { ...data, reason });
  }

  async list(tenantId: string, sessionId: string, offset: number, limit: number): Promise<CapturedOfferListItem[]> {
    const rows = await this.prisma.capturedOffer.findMany({
      where: { tenantId, sessionId },
      include: withGroup,
      orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit,
    });
    return this.withOfferProgress(tenantId, rows.map(toListItem));
  }

  async findById(tenantId: string, id: string): Promise<CapturedOfferListItem | null> {
    const r = await this.prisma.capturedOffer.findFirst({ where: { id, tenantId }, include: withGroup });
    return r ? (await this.withOfferProgress(tenantId, [toListItem(r)]))[0] ?? null : null;
  }

  /** Estado e progresso da oferta de cada captura QUEUED (uma consulta para a página inteira). */
  private async withOfferProgress(tenantId: string, items: CapturedOfferListItem[]): Promise<CapturedOfferListItem[]> {
    const ids = [...new Set(items.map((i) => i.offerId).filter((id): id is string => id !== null))];
    if (ids.length === 0) return items;
    const offers = await this.prisma.offer.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, status: true, dispatches: { select: { status: true } } },
    });
    const byId = new Map(offers.map((o) => [o.id, o]));
    return items.map((i) => {
      const o = i.offerId ? byId.get(i.offerId) : undefined;
      if (!o) return i;
      const sentCount = o.dispatches.filter((d) => d.status === 'SENT').length;
      return { ...i, offerStatus: o.status as OfferStatus, sentCount, totalCount: o.dispatches.length };
    });
  }

  async resetForRetry(tenantId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.capturedOffer.updateMany({
      where: { id, tenantId, status: { in: ['SKIPPED', 'FAILED'] } },
      // Resultado anterior sai: o painel não mostra link/validade de uma tentativa que não valeu
      data: {
        status: 'PENDING', reason: null, claimToken: null, claimedAt: null, processedAt: null,
        affiliateUrl: null, sourceUrl: null, finalText: null, startsAt: null, expiresAt: null, offerId: null,
      },
    });
    return count > 0;
  }
}

function toListItem(r: Row & { monitoredGroup: { conversation: { groupName: string | null; groupAvatarUrl: string | null } } | null }): CapturedOfferListItem {
  return {
    ...toDomain(r),
    sourceGroupTitle: r.monitoredGroup?.conversation.groupName ?? null,
    offerStatus: null, sentCount: 0, totalCount: 0,
    sourceGroupAvatarUrl: r.monitoredGroup?.conversation.groupAvatarUrl ?? null,
  };
}
