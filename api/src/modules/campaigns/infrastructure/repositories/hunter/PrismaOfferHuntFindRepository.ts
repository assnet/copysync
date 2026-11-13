import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  IOfferHuntFindRepository,
  NewOfferHuntFind,
  OfferHuntFindTransition,
  ResendClaim,
  ResendClaimOptions,
} from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import type { OfferHuntPageCursor } from '../../../domain/contracts/hunter/IOfferHuntRunRepository';
import type { OfferHuntFind, OfferHuntFindDelivery, OfferHuntFindStatus } from '../../../domain/hunter/OfferHunt';
import type { HuntProvider } from '../../../domain/hunter/HuntProvider';
import { PrismaOfferHuntMapper as Mapper } from '../../mappers/PrismaOfferHuntMapper';

/** Chave de repetição: caçada + marca + produto (linha antiga sem `productId` usa `goodsId`). */
const repeatKey = (huntId: string, provider: string, productId: string) => `${huntId}:${provider}:${productId}`;

/** Disparo mais recente da oferta atual + nome do grupo (tenant em todo filtro). */
const deliveryInclude = (tenantId: string) => ({
  offer: {
    select: {
      tenantId: true,
      dispatches: {
        where: { tenantId },
        orderBy: { updatedAt: 'desc' as const },
        take: 1,
        select: { status: true, failureReason: true, updatedAt: true, sessionId: true, conversation: { select: { tenantId: true, groupName: true } } },
      },
    },
  },
});
type FindWithDelivery = Prisma.OfferHuntFindGetPayload<{ include: ReturnType<typeof deliveryInclude> }>;

export class PrismaOfferHuntFindRepository implements IOfferHuntFindRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Achados + envio real (status do disparo, grupo e sessão). Nome da sessão numa consulta só, do tenant. */
  private async withDelivery(tenantId: string, rows: FindWithDelivery[]): Promise<OfferHuntFind[]> {
    const sessionIds = [...new Set(rows.flatMap((r) => {
      const d = r.offer?.tenantId === tenantId ? r.offer.dispatches[0] : undefined;
      return d?.sessionId ? [d.sessionId] : [];
    }))];
    const sessions = sessionIds.length === 0 ? [] : await this.prisma.session.findMany({
      where: { tenantId, id: { in: sessionIds } }, select: { id: true, name: true },
    });
    const sessionName = new Map(sessions.map((s) => [s.id, s.name]));
    return rows.map((r) => {
      const { offer, ...raw } = r;
      const find = Mapper.findToDomain(raw);
      const d = offer?.tenantId === tenantId ? offer.dispatches[0] : undefined;
      if (!d) return find;
      const delivery: OfferHuntFindDelivery = {
        dispatchStatus: d.status,
        sentAt: d.status === 'SENT' ? d.updatedAt : null,
        groupName: d.conversation.tenantId === tenantId ? d.conversation.groupName : null,
        sessionName: d.sessionId ? (sessionName.get(d.sessionId) ?? null) : null,
        failureReason: d.failureReason,
        updatedAt: d.updatedAt,
      };
      return { ...find, delivery };
    });
  }

  /**
   * Desenho do `PrismaOfferRepository.createWithinDailyLimit`: `pg_advisory_xact_lock(hashtext(...))` por
   * tenant serializa as reservas até o fim da transação; recontagem + inserção de `min(N, saldo)`.
   */
  async insertWithinDailyLimit(
    tenantId: string, finds: NewOfferHuntFind[], quota: { since: Date; limit: number; repeatSince?: Date },
  ): Promise<OfferHuntFind[]> {
    if (finds.length === 0) return [];
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`offer_hunt_finds:${tenantId}`}::text))`;
      const fresh = await this.withoutRepeats(tx, tenantId, finds, quota.repeatSince);
      const used = await tx.offerHuntFind.count({ where: { tenantId, createdAt: { gte: quota.since } } });
      const room = Math.max(0, quota.limit - used);
      const out = [];
      for (const f of fresh.slice(0, room)) {
        out.push(await tx.offerHuntFind.create({
          data: { ...Mapper.snapshotToData(f), tenantId, huntId: f.huntId, runId: f.runId, status: f.status },
        }));
      }
      return out;
    });
    return rows.map(Mapper.findToDomain);
  }

  /**
   * Anti-join da repetição dentro do lock: duas execuções simultâneas da mesma caçada (MANUAL × AUTO)
   * leem `recentProductIds` antes de qualquer gravação; aqui a 2ª vê o que a 1ª gravou e descarta.
   */
  private async withoutRepeats(
    tx: Prisma.TransactionClient, tenantId: string, finds: NewOfferHuntFind[], repeatSince: Date | undefined,
  ): Promise<NewOfferHuntFind[]> {
    if (!repeatSince) return finds;
    const huntIds = [...new Set(finds.flatMap((f) => (f.huntId ? [f.huntId] : [])))];
    const taken = new Set<string>();
    if (huntIds.length > 0) {
      const rows = await tx.offerHuntFind.findMany({
        where: { tenantId, huntId: { in: huntIds }, createdAt: { gte: repeatSince } },
        select: { huntId: true, provider: true, productId: true, goodsId: true },
      });
      for (const r of rows) {
        const id = r.productId ?? r.goodsId;
        if (r.huntId && id) taken.add(repeatKey(r.huntId, r.provider, id));
      }
    }
    return finds.filter((f) => {
      if (!f.huntId) return true;
      const key = repeatKey(f.huntId, f.provider, f.productId);
      if (taken.has(key)) return false;
      taken.add(key);
      return true;
    });
  }

  countCreatedSince(tenantId: string, since: Date): Promise<number> {
    return this.prisma.offerHuntFind.count({ where: { tenantId, createdAt: { gte: since } } });
  }

  async recentProductIds(tenantId: string, huntId: string, provider: HuntProvider, since: Date): Promise<Set<string>> {
    const rows = await this.prisma.offerHuntFind.findMany({
      where: { tenantId, huntId, provider, createdAt: { gte: since } },
      select: { productId: true, goodsId: true },
      distinct: ['productId', 'goodsId'],
    });
    return new Set(rows.flatMap((r) => { const id = r.productId ?? r.goodsId; return id ? [id] : []; }));
  }

  async findById(tenantId: string, id: string): Promise<OfferHuntFind | null> {
    const raw = await this.prisma.offerHuntFind.findFirst({ where: { id, tenantId }, include: deliveryInclude(tenantId) });
    return raw ? (await this.withDelivery(tenantId, [raw]))[0]! : null;
  }

  async listByHunt(tenantId: string, huntId: string, page: { limit: number; after?: OfferHuntPageCursor }): Promise<OfferHuntFind[]> {
    const after = page.after;
    const rows = await this.prisma.offerHuntFind.findMany({
      where: {
        tenantId, huntId,
        ...(after ? { OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit,
      include: deliveryInclude(tenantId),
    });
    return this.withDelivery(tenantId, rows);
  }

  async transition(
    tenantId: string, id: string, from: OfferHuntFindStatus[], to: OfferHuntFindStatus, extra: OfferHuntFindTransition = {},
  ): Promise<boolean> {
    if (from.length === 0) return false;
    const { count } = await this.prisma.offerHuntFind.updateMany({
      where: { id, tenantId, status: { in: from } },
      data: {
        status: to,
        ...(extra.offerId !== undefined ? { offerId: extra.offerId } : {}),
        ...(extra.failureReason !== undefined ? { failureReason: extra.failureReason } : {}),
      },
    });
    return count > 0;
  }

  /**
   * Lock do tenant (`offer_hunt_resends:<tenant>`, como o teto de achados) serializa claim e contador do dia:
   * dois cliques/abas nunca passam juntos e o teto não estoura. Contador em `offer_hunter_settings`
   * (`resendDayStart`/`resendsInDay`): dia novo zera. A linha de configuração existe (o destino é exigido antes).
   */
  async claimResend(tenantId: string, id: string, offerId: string, now: Date, opts: ResendClaimOptions): Promise<ResendClaim> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`offer_hunt_resends:${tenantId}`}::text))`;
      const f = await tx.offerHuntFind.findFirst({
        where: { id, tenantId }, select: { offerId: true, resendCount: true, lastResentAt: true, resendInFlightUntil: true },
      });
      if (!f || f.offerId !== offerId || (f.resendInFlightUntil && f.resendInFlightUntil > now)) return { kind: 'PENDING' as const };
      const inFlight = { lastResentAt: now, resendInFlightUntil: new Date(now.getTime() + opts.inFlightMs) };
      if (f.resendInFlightUntil) {
        // Reenvio interrompido (oferta não trocada): mesmo número → mesmo sourceKey; não conta de novo
        await tx.offerHuntFind.updateMany({ where: { id, tenantId }, data: inFlight });
        return { kind: 'CLAIMED' as const, number: f.resendCount };
      }
      if (f.lastResentAt && f.lastResentAt.getTime() >= now.getTime() - opts.cooldownMs) return { kind: 'PENDING' as const };
      const s = await tx.offerHunterSettings.findUnique({ where: { tenantId }, select: { resendDayStart: true, resendsInDay: true } });
      const used = s?.resendDayStart?.getTime() === opts.dayStart.getTime() ? s.resendsInDay : 0;
      if (!s || used >= opts.dailyMax) return { kind: 'DAILY_LIMIT' as const };
      await tx.offerHunterSettings.update({ where: { tenantId }, data: { resendDayStart: opts.dayStart, resendsInDay: used + 1 } });
      await tx.offerHuntFind.updateMany({ where: { id, tenantId }, data: { ...inFlight, resendCount: { increment: 1 } } });
      return { kind: 'CLAIMED' as const, number: f.resendCount + 1 };
    });
  }

  async releaseResend(tenantId: string, id: string, number: number, now: Date): Promise<void> {
    await this.prisma.offerHuntFind.updateMany({
      where: { id, tenantId, resendCount: number, resendInFlightUntil: { not: null } },
      data: { resendInFlightUntil: now },
    });
  }

  async recordResend(tenantId: string, id: string, offerId: string, number: number): Promise<void> {
    await this.prisma.offerHuntFind.updateMany({
      where: { id, tenantId, resendCount: number },
      data: { offerId, status: 'SENT', failureReason: null, resendInFlightUntil: null },
    });
  }

  async countResendsInDay(tenantId: string, dayStart: Date): Promise<number> {
    const s = await this.prisma.offerHunterSettings.findUnique({ where: { tenantId }, select: { resendDayStart: true, resendsInDay: true } });
    return s?.resendDayStart?.getTime() === dayStart.getTime() ? s.resendsInDay : 0;
  }

  async reclaimStaleApproved(tenantId: string, id: string, before: Date): Promise<boolean> {
    const { count } = await this.prisma.offerHuntFind.updateMany({
      where: { id, tenantId, status: 'APPROVED', offerId: null, updatedAt: { lt: before } },
      data: { updatedAt: new Date() },
    });
    return count > 0;
  }
}
