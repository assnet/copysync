import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  ClaimDueOptions,
  IOfferDispatchRepository,
  NewOfferDispatchItem,
  OfferDispatchResult,
  StartSendingExpectation,
} from '../../domain/contracts/IOfferDispatchRepository';
import type { OfferDispatch } from '../../domain/entities/OfferDispatch';
import type { OfferOrigin } from '../../domain/enums/OfferOrigin';
import { OFFER_DISPATCH_STATUSES, type OfferDispatchStatus } from '../../domain/enums/OfferDispatchStatus';
import { PrismaOfferDispatchMapper as Mapper, type OfferDispatchRawRow } from '../mappers/PrismaOfferDispatchMapper';
import { POSTING_TIME_ZONE, weekdayInZone } from '../../domain/services/postingWindow';
import { LANE_TIMEOUT_HOLD_SECONDS } from '../../domain/offerTyping';

/** Folga (s) no intervalo mínimo da faixa: o claim acontece até um tick depois do `notBefore`. */
export const LANE_GAP_TOLERANCE_SECONDS = 5;
/** Fuso do horário de postagem (mesmo de `postingWindow`/`operatingWindow`). */
const WINDOW_TIME_ZONE = POSTING_TIME_ZONE;
/** Envio em SEND_TIMEOUT segura a faixa ao menos isso (constante do domínio, reusada no reenvio do caçador). */
export { LANE_TIMEOUT_HOLD_SECONDS };
/**
 * Claim com 1 vaga (sem como alternar): manual/curada vai antes só se a cabeça do monitoramento mais antiga
 * não estiver atrasada mais que isto; senão sai a do monitoramento (anti-starvation).
 */
export const MANUAL_PRIORITY_MAX_STARVE_SECONDS = 600;

/**
 * SQL de "a janela da linha `alias` está aberta agora", espelho de `isWithinPostingWindow`
 * (`postingWindow.ts`): faixa de minutos + `weekdaysMask` (bit 0 = domingo). Faixa que cruza a
 * meia-noite: o trecho após o início usa o bit de hoje; o trecho após 00:00, o bit de ontem (dia do início).
 * `alias` é sempre literal interno (nunca entrada do usuário).
 */
export function postingWindowOpenSql(alias: 'g' | 'c', zoneMinute: Prisma.Sql, todayBit: number, prevBit: number): Prisma.Sql {
  const start = Prisma.raw(`${alias}."windowStartMinute"`);
  const end = Prisma.raw(`${alias}."windowEndMinute"`);
  const mask = Prisma.raw(`${alias}."weekdaysMask"`);
  const today = Prisma.sql`(${mask} & ${todayBit}::int) <> 0`;
  const prev = Prisma.sql`(${mask} & ${prevBit}::int) <> 0`;
  return Prisma.sql`(
    ((${start} % 1440) <= ${end} AND ${today}
      AND ((${start} = 0 AND ${end} = 1440) OR (${zoneMinute} >= (${start} % 1440) AND ${zoneMinute} < ${end})))
    OR ((${start} % 1440) > ${end}
      AND ((${zoneMinute} >= (${start} % 1440) AND ${today}) OR (${zoneMinute} < ${end} AND ${prev})))
  )`;
}

/**
 * Minuto do dia de `now` em São Paulo. `now` é instante absoluto (`timestamptz`): o resultado não
 * depende do `TimeZone` da sessão do Postgres (`::timestamp` dependia).
 */
export function zoneMinuteSql(now: Date): Prisma.Sql {
  const local = Prisma.sql`(${now}::timestamptz AT TIME ZONE ${WINDOW_TIME_ZONE})`;
  return Prisma.sql`(EXTRACT(HOUR FROM ${local})::int * 60 + EXTRACT(MINUTE FROM ${local})::int)`;
}

export class PrismaOfferDispatchRepository implements IOfferDispatchRepository {
  /** `workerId`: id deste processo no lease de sessão (`currentWorkerId()`); o claim ignora sessões de outro dono. */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly workerId: string,
  ) {}

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
   * Filtros no candidato (docs/fila-de-envio.md): tenant com pausa global não sai; oferta do
   * monitoramento só sai dentro do horário de postagem da configuração (minuto do dia e dia da
   * semana em São Paulo, inclusive janela que cruza a meia-noite); oferta do gerador sem `scheduledAt`
   * só sai dentro do horário do gerador do tenant (com `scheduledAt` o operador escolheu a hora:
   * ignora a janela; tenant sem configuração não tem janela). Filtrar no candidato, e não na cabeça, deixa a
   * cabeça da faixa ser o próximo elegível (o gerador não fica preso atrás de uma captura fora da janela).
   *
   * Prioridade na faixa: envio vencido manual/curado (gerador e caçador) sai antes de qualquer captura
   * do monitoramento da mesma sessão, mesmo com milhares de capturas acumuladas mais antigas. Entre
   * sessões, fila justa no LIMIT do tick: até ceil(limit/2) cabeças manuais (por notBefore) e o resto
   * por notBefore entre as demais; com limit 1, manual antes só se nenhuma cabeça do monitoramento estiver
   * atrasada mais que MANUAL_PRIORITY_MAX_STARVE_SECONDS (monitoramento nunca morre de fome). O intervalo da sessão
   * (gapSeconds/SENT recente) continua valendo: só muda quem é a cabeça.
   *
   * Dono da sessão (docs/arquitetura-escala.md §3.3): envio cuja sessão tem lease vivo de OUTRO
   * processo (`ownerWorkerId <> workerId AND leaseUntil > now() AT TIME ZONE 'UTC'`, relógio do banco,
   * mesma definição do lease) não é candidato — só o dono do socket envia. Sessão minha ou sem dono
   * vivo: como antes; `sessionId` nulo nunca é excluído. Anti-join com o conjunto (pequeno) de
   * sessões alheias, aplicado antes do DISTINCT ON, nos dois caminhos (sequencial e concorrente).
   * EXPLAIN ANALYZE (Postgres 16 descartável, 50k envios/500 QUEUED, 3,2k sessões, ~1 ms): o candidato
   * segue em `offer_dispatches_status_notBefore_idx` e a subquery vira `hashed SubPlan` avaliado UMA vez
   * (Seq Scan em "sessions": `<>` não usa `sessions_ownerWorkerId_idx`; tabela pequena) — sem lookup por linha.
   */
  async claimDue(now: Date, limit: number, options: ClaimDueOptions = {}): Promise<OfferDispatch[]> {
    if (limit <= 0) return [];
    // Concorrência 2: sessões da rodada / com sender pendente ficam de fora. Vazio = SQL de sempre
    const excluded = [...new Set(options.excludeSessionIds ?? [])];
    const excludeSql = excluded.length > 0
      ? Prisma.sql`AND (heads."sessionId" IS NULL OR heads."sessionId" <> ALL(${excluded}::text[]))`
      : Prisma.empty;
    const zoneMinute = zoneMinuteSql(now);
    // Dia da semana no fuso (hoje e ontem) calculado aqui pela mesma regra do domínio
    const zoneWeekday = weekdayInZone(now, WINDOW_TIME_ZONE);
    const prevWeekday = (zoneWeekday + 6) % 7;
    const monitorOpen = postingWindowOpenSql('g', zoneMinute, 1 << zoneWeekday, 1 << prevWeekday);
    const generatorOpen = postingWindowOpenSql('c', zoneMinute, 1 << zoneWeekday, 1 << prevWeekday);
    const manualQuota = Math.ceil(limit / 2);
    const starveBefore = new Date(now.getTime() - MANUAL_PRIORITY_MAX_STARVE_SECONDS * 1000);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('offer_dispatch_claim'))`;
      const rows = await tx.$queryRaw<OfferDispatchRawRow[]>`
        UPDATE "offer_dispatches"
           SET "status" = 'SENDING'::"OfferDispatchStatus", "claimedAt" = now(),
               "claimToken" = gen_random_uuid()::text, "updatedAt" = now()
         WHERE "status" = 'QUEUED'::"OfferDispatchStatus"
           AND "id" IN (
             -- Fila justa entre sessões: até ceil(limit/2) vagas para cabeças manuais/curadas (por notBefore);
             -- o resto por notBefore entre as demais (manuais excedentes ou monitoramento). Com limit 1, manual
             -- só vai antes se nenhuma cabeça do monitoramento estiver atrasada mais que MANUAL_PRIORITY_MAX_STARVE_SECONDS
             SELECT r."id" FROM (
             SELECT e."id", e."notBefore", e."monitoring",
                    row_number() OVER (PARTITION BY e."monitoring" ORDER BY e."notBefore", e."id") AS "rank",
                    bool_or(e."monitoring" AND e."notBefore" < ${starveBefore}) OVER () AS "monitoringStarved"
               FROM (
             SELECT heads.* FROM (
               SELECT DISTINCT ON (COALESCE(d."sessionId", d."id"))
                      d."id", d."notBefore", d."sessionId", d."gapSeconds",
                      (od."origin" NOT IN ('GENERATOR'::"OfferOrigin", 'HUNTER'::"OfferOrigin")) AS "monitoring"
                 FROM "offer_dispatches" d
                 JOIN "offers" od ON od."id" = d."offerId" AND od."status" = 'SENDING'::"OfferStatus"
                WHERE d."status" = 'QUEUED'::"OfferDispatchStatus" AND d."notBefore" <= ${now}
                  -- Sessão com lease vivo de outro processo: só o dono envia (nulo nunca entra no NOT IN)
                  AND (d."sessionId" IS NULL OR d."sessionId" NOT IN (
                    SELECT s."id" FROM "sessions" s
                     WHERE s."ownerWorkerId" <> ${this.workerId} AND s."leaseUntil" > (now() AT TIME ZONE 'UTC')))
                  -- Pausa global do tenant; suspenso/cancelado (billing) fica QUEUED até reativar
                  AND d."tenantId" IN (SELECT "id" FROM "tenants" WHERE "sendingPausedAt" IS NULL AND "status" = 'ACTIVE'::"TenantStatus")
                  -- Oferta do monitoramento fora do horário de postagem da configuração espera a janela abrir
                  AND NOT EXISTS (
                    SELECT 1 FROM "offers" mo
                      -- Janela da configuração de ORIGEM (sessão cruzada envia por outra); oferta antiga sem
                      -- monitorConfigId cai na configuração da sessão que envia
                      JOIN "group_monitor_configs" g
                        ON g."id" = COALESCE(mo."monitorConfigId",
                             (SELECT c."id" FROM "group_monitor_configs" c WHERE c."sessionId" = d."sessionId" AND c."tenantId" = d."tenantId" LIMIT 1))
                     WHERE mo."id" = d."offerId" AND mo."origin" = 'MONITORING'::"OfferOrigin"
                       AND NOT ${monitorOpen}
                  )
                  -- Oferta do gerador sem horário escolhido fora do horário do gerador espera a janela abrir
                  AND NOT EXISTS (
                    SELECT 1 FROM "offers" go
                      JOIN "offer_generator_configs" c ON c."tenantId" = go."tenantId"
                     WHERE go."id" = d."offerId" AND go."origin" = 'GENERATOR'::"OfferOrigin" AND go."scheduledAt" IS NULL
                       AND NOT ${generatorOpen}
                  )
                -- Manual/curada (gerador e caçador) fura a fila do monitoramento na faixa da sessão; dentro
                -- do grupo, quem esperava a sessão reconectar volta primeiro (a ordem da fila se mantém)
                ORDER BY COALESCE(d."sessionId", d."id"),
                         "monitoring",
                         (d."waitingSessionSince" IS NULL), d."notBefore", d."id"
             ) heads
              WHERE NOT EXISTS (
                -- Sessão em espera: envio devolvido por sessão fora do ar ainda não chegou na nova tentativa
                SELECT 1 FROM "offer_dispatches" w
                 WHERE w."sessionId" = heads."sessionId" AND w."status" = 'QUEUED'::"OfferDispatchStatus"
                   AND w."waitingSessionSince" IS NOT NULL AND w."notBefore" > ${now}
              )
              ${excludeSql}
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
             ) e
             ) r
              -- Entre sessões, cabeça manual/curada na cota antes (senão a faixa que acabou de ganhar um envio
              -- manual, com notBefore mais novo, perderia a vaga do tick para capturas velhas de outras sessões);
              -- a cota nunca toma todas as vagas, então o monitoramento não morre de fome
              ORDER BY (NOT r."monitoring" AND r."rank" <= ${manualQuota} AND NOT (${limit === 1} AND r."monitoringStarved")) DESC,
                       r."notBefore", r."id"
              LIMIT ${limit}
           )
        RETURNING *`;
      return rows.map(Mapper.fromRawRow);
    });
  }

  async openNotBefore(tenantId: string, sessionId: string, from: Date, origin?: OfferOrigin | readonly OfferOrigin[]): Promise<Date[]> {
    const origins = origin === undefined ? undefined : typeof origin === 'string' ? [origin] : [...origin];
    const rows = await this.prisma.offerDispatch.findMany({
      where: {
        tenantId, sessionId, status: { in: ['QUEUED', 'SENDING'] },
        offer: { status: 'SENDING', ...(origins ? { origin: { in: origins } } : {}), OR: [{ scheduledAt: null }, { scheduledAt: { lte: from } }], AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: from } }] }] },
      },
      select: { notBefore: true },
      orderBy: { notBefore: 'asc' },
    });
    return rows.map((r) => r.notBefore);
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

  async skipExpired(now: Date): Promise<number> {
    const r = await this.prisma.offerDispatch.updateMany({
      // Só oferta SENDING: PAUSED fica como está (retomar continua válido e decide no envio)
      where: { status: 'QUEUED', offer: { status: 'SENDING', expiresAt: { lte: now } } },
      data: { status: 'SKIPPED', failureReason: 'OFFER_EXPIRED' },
    });
    return r.count;
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
      // SEND_TIMEOUT segura a faixa no claim por GREATEST(gap do próximo, hold); aqui conta como
      // "último envio" em claimedAt + hold: quem consome soma o intervalo, então a prévia fica em
      // ou depois da liberação real (nunca antes: o claim respeitaria o notBefore de qualquer jeito)
      this.prisma.$queryRaw<{ last: Date | null }[]>`
        SELECT MAX(CASE WHEN d."status" = 'FAILED'::"OfferDispatchStatus"
                        THEN d."claimedAt" + make_interval(secs => ${LANE_TIMEOUT_HOLD_SECONDS})
                        ELSE d."claimedAt" END) AS last
          FROM "offer_dispatches" d
         WHERE d."tenantId" = ${tenantId} AND d."sessionId" = ${sessionId} AND d."claimedAt" IS NOT NULL
           AND (d."status" IN ('SENDING'::"OfferDispatchStatus", 'SENT'::"OfferDispatchStatus")
                OR (d."status" = 'FAILED'::"OfferDispatchStatus" AND d."failureReason" = 'SEND_TIMEOUT'))`,
    ]);
    return { open: open.map(Mapper.toDomain), lastClaimedAt: last[0]?.last ?? null };
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

  async deferForOfflineSession(
    id: string, tenantId: string, claimToken: string, retryAt: Date, waitingSince: Date, waitReason: string | null = null,
  ): Promise<boolean> {
    const { count } = await this.prisma.offerDispatch.updateMany({
      where: { id, tenantId, claimToken, status: 'SENDING', offer: { status: { in: ['SENDING', 'PAUSED'] } } },
      data: { status: 'QUEUED', claimToken: null, claimedAt: null, notBefore: retryAt, waitingSessionSince: waitingSince, failureReason: waitReason },
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
