import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  IOfferDispatchRepository,
  NewOfferDispatchItem,
  OfferDispatchResult,
  StartSendingExpectation,
} from '../../domain/contracts/IOfferDispatchRepository';
import type { OfferDispatch } from '../../domain/entities/OfferDispatch';
import { OFFER_DISPATCH_STATUSES, type OfferDispatchStatus } from '../../domain/enums/OfferDispatchStatus';
import { PrismaOfferDispatchMapper as Mapper, type OfferDispatchRawRow } from '../mappers/PrismaOfferDispatchMapper';

/** Folga (s) no intervalo mínimo da faixa: o claim acontece até um tick depois do `notBefore`. */
export const LANE_GAP_TOLERANCE_SECONDS = 5;
/** Fuso da janela de operação do monitoramento (mesmo de `startOfDayInZone`/`operatingWindow`). */
const WINDOW_TIME_ZONE = 'America/Sao_Paulo';
/** Envio em SEND_TIMEOUT segura a faixa ao menos isso: timeout (60 s) + digitação (até 30 s), com folga. */
export const LANE_TIMEOUT_HOLD_SECONDS = 120;

export class PrismaOfferDispatchRepository implements IOfferDispatchRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Transição da oferta + criação dos envios na mesma transação: sem oferta SENDING órfã nem
   * envio de oferta ainda editável. Só DRAFT com o `mentionAll` validado: oferta FAILED não reenvia (reenvio = nova oferta, P2).
   */
  async startSending(
    offerId: string,
    tenantId: string,
    expected: StartSendingExpectation,
    items: NewOfferDispatchItem[],
  ): Promise<OfferDispatch[] | null> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.offer.updateMany({
        where: { id: offerId, tenantId, status: 'DRAFT', mentionAll: expected.mentionAll },
        data: { status: 'SENDING' },
      });
      if (count === 0) return null;
      if (items.length === 0) return [];
      const rows = await tx.offerDispatch.createManyAndReturn({
        data: items.map((i) => ({
          tenantId,
          offerId,
          conversationId: i.conversationId,
          sessionId: i.sessionId,
          gapSeconds: i.gapSeconds,
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
   *
   * Faixa por sessão (docs/fila-de-envio.md): o candidato de cada sessão é o QUEUED vencido de
   * menor `notBefore` (DISTINCT ON), e só entra se a sessão não tem envio SENDING nem SENT
   * iniciado (`claimedAt`) há menos de `gapSeconds` (menos LANE_GAP_TOLERANCE_SECONDS, folga para a
   * latência do tick não empurrar a cadência da própria oferta). Envio sem sessão (legado, anterior
   * à fila) não tem faixa: sai como antes, sem série nem intervalo.
   * DISTINCT ON não combina com FOR UPDATE: claims concorrentes são serializados pelo advisory
   * lock da transação, o que também impede dois workers de abrirem a mesma faixa.
   * `gen_random_uuid()` (nativo no PG ≥ 13) é volátil: um token por linha.
   *
   * Dois filtros no candidato (docs/fila-de-envio.md): tenant com pausa global não sai; oferta do
   * monitoramento só sai dentro da janela de operação da sessão (minuto do dia em São Paulo,
   * inclusive janela que cruza a meia-noite). Filtrar no candidato, e não na cabeça, deixa a
   * cabeça da faixa ser o próximo elegível (o gerador não fica preso atrás de uma captura fora da janela).
   */
  async claimDue(now: Date, limit: number): Promise<OfferDispatch[]> {
    if (limit <= 0) return [];
    // `now` chega como timestamp sem fuso em UTC (padrão das colunas); vira minuto do dia no fuso
    const zoneMinute = Prisma.sql`(EXTRACT(HOUR FROM ((${now}::timestamp AT TIME ZONE 'UTC') AT TIME ZONE ${WINDOW_TIME_ZONE}))::int * 60
      + EXTRACT(MINUTE FROM ((${now}::timestamp AT TIME ZONE 'UTC') AT TIME ZONE ${WINDOW_TIME_ZONE}))::int)`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('offer_dispatch_claim'))`;
      const rows = await tx.$queryRaw<OfferDispatchRawRow[]>`
        UPDATE "offer_dispatches"
           SET "status" = 'SENDING'::"OfferDispatchStatus", "claimedAt" = now(),
               "claimToken" = gen_random_uuid()::text, "updatedAt" = now()
         WHERE "status" = 'QUEUED'::"OfferDispatchStatus"
           AND "id" IN (
             SELECT "id" FROM (
               SELECT DISTINCT ON (COALESCE(d."sessionId", d."id"))
                      d."id", d."notBefore", d."sessionId", d."gapSeconds"
                 FROM "offer_dispatches" d
                WHERE d."status" = 'QUEUED'::"OfferDispatchStatus" AND d."notBefore" <= ${now}
                  AND d."offerId" IN (SELECT "id" FROM "offers" WHERE "status" = 'SENDING'::"OfferStatus")
                  -- Pausa global do tenant
                  AND d."tenantId" NOT IN (SELECT "id" FROM "tenants" WHERE "sendingPausedAt" IS NOT NULL)
                  -- Oferta do monitoramento fora da janela de operação da sessão espera a janela abrir
                  AND NOT EXISTS (
                    SELECT 1 FROM "offers" mo
                      -- Janela da configuração de ORIGEM (sessão cruzada envia por outra); oferta antiga sem
                      -- monitorConfigId cai na configuração da sessão que envia
                      JOIN "group_monitor_configs" g
                        ON g."id" = COALESCE(mo."monitorConfigId",
                             (SELECT c."id" FROM "group_monitor_configs" c WHERE c."sessionId" = d."sessionId" AND c."tenantId" = d."tenantId" LIMIT 1))
                     WHERE mo."id" = d."offerId" AND mo."origin" = 'MONITORING'::"OfferOrigin"
                       AND NOT (
                         (g."windowStartMinute" = 0 AND g."windowEndMinute" = 1440)
                         OR ((g."windowStartMinute" % 1440) <= g."windowEndMinute"
                             AND ${zoneMinute} >= (g."windowStartMinute" % 1440) AND ${zoneMinute} < g."windowEndMinute")
                         OR ((g."windowStartMinute" % 1440) > g."windowEndMinute"
                             AND (${zoneMinute} >= (g."windowStartMinute" % 1440) OR ${zoneMinute} < g."windowEndMinute"))
                       )
                  )
                -- Quem esperava a sessão reconectar volta primeiro (a ordem da fila se mantém)
                ORDER BY COALESCE(d."sessionId", d."id"), (d."waitingSessionSince" IS NULL), d."notBefore"
             ) heads
              WHERE NOT EXISTS (
                -- Sessão em espera: envio devolvido por sessão fora do ar ainda não chegou na nova tentativa
                SELECT 1 FROM "offer_dispatches" w
                 WHERE w."sessionId" = heads."sessionId" AND w."status" = 'QUEUED'::"OfferDispatchStatus"
                   AND w."waitingSessionSince" IS NOT NULL AND w."notBefore" > ${now}
              )
              AND NOT EXISTS (
                SELECT 1 FROM "offer_dispatches" o
                 WHERE o."sessionId" = heads."sessionId"
                   AND (o."status" = 'SENDING'::"OfferDispatchStatus"
                        OR (o."status" = 'SENT'::"OfferDispatchStatus"
                            AND o."claimedAt" + make_interval(secs => GREATEST(heads."gapSeconds" - ${LANE_GAP_TOLERANCE_SECONDS}, 0)) > ${now})
                        -- SEND_TIMEOUT: a mensagem pode ainda estar saindo; segura pelo menos timeout + digitação
                        OR (o."status" = 'FAILED'::"OfferDispatchStatus" AND o."failureReason" = 'SEND_TIMEOUT'
                            AND o."claimedAt" + make_interval(secs => GREATEST(heads."gapSeconds" - ${LANE_GAP_TOLERANCE_SECONDS}, ${LANE_TIMEOUT_HOLD_SECONDS})) > ${now}))
              )
              ORDER BY heads."notBefore"
              LIMIT ${limit}
           )
        RETURNING *`;
      return rows.map(Mapper.fromRawRow);
    });
  }

  async laneTails(tenantId: string, sessionIds: readonly string[], startAt: Date): Promise<Map<string, Date>> {
    if (sessionIds.length === 0) return new Map();
    const groups = await this.prisma.offerDispatch.groupBy({
      by: ['sessionId'],
      where: {
        tenantId,
        sessionId: { in: [...sessionIds] },
        status: { in: ['QUEUED', 'SENDING'] },
        offer: { status: 'SENDING', OR: [{ scheduledAt: null }, { scheduledAt: { lte: startAt } }] },
      },
      _max: { notBefore: true },
    });
    const out = new Map<string, Date>();
    for (const g of groups) if (g.sessionId && g._max.notBefore) out.set(g.sessionId, g._max.notBefore);
    return out;
  }

  /** Retomada: uma transação, ordem de `notBefore` preservada (só o horário muda). */
  async rescheduleQueued(offerId: string, tenantId: string, slots: Date[]): Promise<number> {
    if (slots.length === 0) return 0;
    return this.prisma.$transaction(async (tx) => {
      const queued = await tx.offerDispatch.findMany({
        where: { offerId, tenantId, status: 'QUEUED' },
        orderBy: { notBefore: 'asc' },
        select: { id: true },
        take: slots.length,
      });
      for (const [i, row] of queued.entries()) {
        await tx.offerDispatch.update({ where: { id: row.id }, data: { notBefore: slots[i]! } });
      }
      return queued.length;
    });
  }

  async laneState(tenantId: string, sessionId: string, now: Date): Promise<{ open: OfferDispatch[]; lastClaimedAt: Date | null }> {
    const [open, last] = await Promise.all([
      this.prisma.offerDispatch.findMany({
        where: {
          tenantId, sessionId, status: 'QUEUED',
          // Oferta vencida pela validade não ocupa lugar no reespalhar/compactar: o worker a pula no envio
          offer: { status: 'SENDING', OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }], AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] },
        },
        orderBy: { notBefore: 'asc' },
      }),
      this.prisma.offerDispatch.aggregate({
        where: { tenantId, sessionId, status: { in: ['SENDING', 'SENT'] }, claimedAt: { not: null } },
        _max: { claimedAt: true },
      }),
    ]);
    return { open: open.map(Mapper.toDomain), lastClaimedAt: last._max.claimedAt ?? null };
  }

  async openSessionIds(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.offerDispatch.findMany({
      where: { tenantId, status: 'QUEUED', sessionId: { not: null }, offer: { status: 'SENDING' } },
      distinct: ['sessionId'],
      select: { sessionId: true },
    });
    return rows.flatMap((r) => (r.sessionId ? [r.sessionId] : []));
  }

  async rescheduleMany(tenantId: string, slots: readonly { id: string; notBefore: Date }[]): Promise<number> {
    if (slots.length === 0) return 0;
    const counts = await this.prisma.$transaction(
      slots.map((s) => this.prisma.offerDispatch.updateMany({ where: { id: s.id, tenantId, status: 'QUEUED' }, data: { notBefore: s.notBefore } })),
    );
    return counts.reduce((n, c) => n + c.count, 0);
  }

  async cancelQueued(offerId: string, tenantId: string): Promise<number> {
    const { count } = await this.prisma.offerDispatch.updateMany({
      where: { offerId, tenantId, status: 'QUEUED' },
      data: { status: 'CANCELLED' },
    });
    return count;
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
    const stale = { status: 'SENDING' as const, claimedAt: { lt: olderThan }, chatMessageId: null };
    // Oferta parada enquanto o envio travou: fecha como cancelado em vez de voltar à fila (órfão)
    await this.prisma.offerDispatch.updateMany({
      where: { ...stale, offer: { status: 'CANCELLED' } },
      data: { status: 'CANCELLED', claimedAt: null, claimToken: null },
    });
    const { count } = await this.prisma.offerDispatch.updateMany({
      where: stale,
      data: { status: 'QUEUED', claimedAt: null, claimToken: null },
    });
    return count;
  }

  async deferForOfflineSession(id: string, tenantId: string, claimToken: string, retryAt: Date, waitingSince: Date): Promise<boolean> {
    const { count } = await this.prisma.offerDispatch.updateMany({
      where: { id, tenantId, claimToken, status: 'SENDING', offer: { status: { in: ['SENDING', 'PAUSED'] } } },
      data: { status: 'QUEUED', claimToken: null, claimedAt: null, notBefore: retryAt, waitingSessionSince: waitingSince },
    });
    return count > 0;
  }

  async failOverdueInSession(tenantId: string, sessionId: string, now: Date, failureReason: string, offerId: string): Promise<number> {
    const { count } = await this.prisma.offerDispatch.updateMany({
      where: {
        tenantId, sessionId, status: 'QUEUED', offer: { status: 'SENDING' },
        OR: [{ notBefore: { lte: now } }, { offerId }],
      },
      data: { status: 'FAILED', failureReason },
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

  /** CROSS-TENANT por design (varredura do worker): ofertas SENDING/PAUSED sem envio aberto. */
  async findSendingWithoutOpenDispatches(limit: number): Promise<{ id: string; tenantId: string }[]> {
    if (limit <= 0) return [];
    return this.prisma.offer.findMany({
      where: { status: { in: ['SENDING', 'PAUSED'] }, dispatches: { none: { status: { in: ['QUEUED', 'SENDING'] } } } },
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
