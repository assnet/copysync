import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { Prisma } from '@prisma/client';
import { PrismaOfferDispatchRepository, postingWindowOpenSql, zoneMinuteSql } from './PrismaOfferDispatchRepository';
import { isWithinPostingWindow, weekdayInZone, type PostingWindow } from '../../domain/services/postingWindow';

/**
 * `claimDue` contra o Postgres real (docs/fila-de-envio.md): janela de operação do monitoramento
 * e pausa global do tenant. Horários em UTC; a janela é em São Paulo (UTC-3).
 */
const repo = new PrismaOfferDispatchRepository(prisma, 'worker-test');
let tenantId = '';
let sessionId = '';
let convMon = '';
let convGen = '';

const spToUtc = (hh: number, mm = 0, day = 28) => new Date(Date.UTC(2026, 9, day, hh + 3, mm)); // dd/10/2026 hh:mm em SP

async function offer(origin: 'GENERATOR' | 'MONITORING') {
  return prisma.offer.create({ data: { tenantId, provider: 'AMAZON', sourceUrl: 'x', affiliateUrl: 'x', text: 'x', status: 'SENDING', origin } });
}
async function queued(offerId: string, conversationId: string, notBefore: Date) {
  return prisma.offerDispatch.create({ data: { tenantId, offerId, conversationId, sessionId, notBefore, status: 'QUEUED', gapSeconds: 0 } });
}
async function reset() {
  await prisma.offerDispatch.deleteMany({ where: { tenantId } });
  await prisma.offer.deleteMany({ where: { tenantId } });
}

beforeAll(async () => {
  const t = await prisma.tenant.create({ data: { name: 'int', slug: `int-claim-${Date.now()}` } });
  tenantId = t.id;
  const s = await prisma.session.create({ data: { tenantId, name: 'S', status: 'CONNECTED' } });
  sessionId = s.id;
  convMon = (await prisma.chatConversation.create({ data: { tenantId, sessionId, isGroup: true, groupJid: 'm' } })).id;
  convGen = (await prisma.chatConversation.create({ data: { tenantId, sessionId, isGroup: true, groupJid: 'g' } })).id;
  // janela 06:00–20:00 em São Paulo
  await prisma.groupMonitorConfig.create({ data: { tenantId, sessionId, enabled: true, windowStartMinute: 360, windowEndMinute: 1200 } });
});
afterAll(async () => {
  await reset();
  await prisma.groupMonitorConfig.deleteMany({ where: { tenantId } });
  await prisma.offerGeneratorConfig.deleteMany({ where: { tenantId } });
  await prisma.chatConversation.deleteMany({ where: { tenantId } });
  await prisma.session.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('claimDue — janela de operação', () => {
  it('oferta do monitoramento só sai dentro da janela; o gerador não é afetado', async () => {
    await reset();
    const mon = await offer('MONITORING');
    const gen = await offer('GENERATOR');
    await queued(mon.id, convMon, spToUtc(5));
    await queued(gen.id, convGen, spToUtc(5));
    // 21:30 em SP: fora da janela → só o gerador sai (e a cabeça da faixa não fica presa na captura)
    const night = await repo.claimDue(spToUtc(21, 30), 10);
    expect(night.map((d) => d.offerId)).toEqual([gen.id]);
    // o envio do gerador termina (a faixa fica livre); 09:00 do dia seguinte em SP: a captura sai
    await prisma.offerDispatch.update({ where: { id: night[0]!.id }, data: { status: 'SENT', chatMessageId: 'm', claimedAt: spToUtc(21, 30) } });
    const day = await repo.claimDue(spToUtc(9, 0, 29), 10);
    expect(day.map((d) => d.offerId)).toEqual([mon.id]);
  });

  it('janela noturna (22:00 → 06:00) e dia inteiro', async () => {
    await reset();
    await prisma.groupMonitorConfig.updateMany({ where: { tenantId, sessionId }, data: { windowStartMinute: 1320, windowEndMinute: 360 } });
    const mon = await offer('MONITORING');
    await queued(mon.id, convMon, spToUtc(1));
    expect(await repo.claimDue(spToUtc(14), 10)).toEqual([]);
    expect((await repo.claimDue(spToUtc(23), 10)).map((d) => d.offerId)).toEqual([mon.id]);
    await reset();
    await prisma.groupMonitorConfig.updateMany({ where: { tenantId, sessionId }, data: { windowStartMinute: 0, windowEndMinute: 1440 } });
    const any = await offer('MONITORING');
    await queued(any.id, convMon, spToUtc(1));
    expect((await repo.claimDue(spToUtc(3), 10)).map((d) => d.offerId)).toEqual([any.id]);
    await prisma.groupMonitorConfig.updateMany({ where: { tenantId, sessionId }, data: { windowStartMinute: 360, windowEndMinute: 1200 } });
  });
});

// 28/10/2026 = quarta (3), 30 = sexta (5), 31 = sábado (6), 32 → 01/11 = domingo (0)
describe('claimDue — dias da semana do monitoramento', () => {
  afterAll(async () => {
    await prisma.groupMonitorConfig.updateMany({ where: { tenantId, sessionId }, data: { windowStartMinute: 360, windowEndMinute: 1200, weekdaysMask: 127 } });
  });

  it('dia fora do mask não reivindica; dia do mask sai', async () => {
    await reset();
    // só fim de semana, 06–20
    await prisma.groupMonitorConfig.updateMany({ where: { tenantId, sessionId }, data: { weekdaysMask: 0b1000001 } });
    const mon = await offer('MONITORING');
    await queued(mon.id, convMon, spToUtc(5));
    expect(await repo.claimDue(spToUtc(9, 0, 28), 10)).toEqual([]);
    expect((await repo.claimDue(spToUtc(9, 0, 31), 10)).map((d) => d.offerId)).toEqual([mon.id]);
  });

  it('janela sexta 22–02: sábado 01:00 é de sexta (sai); sábado 23:00 não; sexta 00:30 é de quinta (não sai)', async () => {
    await reset();
    await prisma.groupMonitorConfig.updateMany({ where: { tenantId, sessionId }, data: { windowStartMinute: 1320, windowEndMinute: 120, weekdaysMask: 1 << 5 } });
    const mon = await offer('MONITORING');
    await queued(mon.id, convMon, spToUtc(0, 0, 28));
    expect(await repo.claimDue(spToUtc(0, 30, 30), 10)).toEqual([]);
    expect(await repo.claimDue(spToUtc(23, 0, 31), 10)).toEqual([]);
    expect((await repo.claimDue(spToUtc(1, 0, 31), 10)).map((d) => d.offerId)).toEqual([mon.id]);
  });

  it('virada 23:59 → 00:00 com janela 22–02 só de quarta', async () => {
    await reset();
    await prisma.groupMonitorConfig.updateMany({ where: { tenantId, sessionId }, data: { windowStartMinute: 1320, windowEndMinute: 120, weekdaysMask: 1 << 3 } });
    const a = await offer('MONITORING');
    await queued(a.id, convMon, spToUtc(0, 0, 28));
    expect((await repo.claimDue(spToUtc(23, 59, 28), 10)).map((d) => d.offerId)).toEqual([a.id]);
    await reset();
    const b = await offer('MONITORING');
    await queued(b.id, convMon, spToUtc(0, 0, 28));
    expect((await repo.claimDue(spToUtc(0, 0, 29), 10)).map((d) => d.offerId)).toEqual([b.id]);
    // terça 23:59 e quinta 23:59: fora (início não é quarta)
    await reset();
    const c = await offer('MONITORING');
    await queued(c.id, convMon, spToUtc(0, 0, 27));
    expect(await repo.claimDue(spToUtc(23, 59, 27), 10)).toEqual([]);
    expect(await repo.claimDue(spToUtc(23, 59, 29), 10)).toEqual([]);
  });
});

describe('claimDue — horário do gerador', () => {
  afterAll(async () => {
    await prisma.offerGeneratorConfig.deleteMany({ where: { tenantId } });
  });

  it('gerador padrão (0–1440, todos os dias) sai como hoje a qualquer hora', async () => {
    await reset();
    await prisma.offerGeneratorConfig.upsert({ where: { tenantId }, create: { tenantId }, update: { windowStartMinute: 0, windowEndMinute: 1440, weekdaysMask: 127 } });
    const gen = await offer('GENERATOR');
    await queued(gen.id, convGen, spToUtc(0, 0, 28));
    expect((await repo.claimDue(spToUtc(3, 0, 32), 10)).map((d) => d.offerId)).toEqual([gen.id]);
  });

  it('fora da janela/dia do gerador não sai; dentro sai; monitoramento não é afetado pelo gerador', async () => {
    await reset();
    // 08–18 só dias úteis
    await prisma.offerGeneratorConfig.upsert({ where: { tenantId }, create: { tenantId, windowStartMinute: 480, windowEndMinute: 1080, weekdaysMask: 0b0111110 }, update: { windowStartMinute: 480, windowEndMinute: 1080, weekdaysMask: 0b0111110 } });
    const gen = await offer('GENERATOR');
    await queued(gen.id, convGen, spToUtc(0, 0, 28));
    expect(await repo.claimDue(spToUtc(19, 0, 28), 10)).toEqual([]);
    expect(await repo.claimDue(spToUtc(10, 0, 31), 10)).toEqual([]);
    const mon = await offer('MONITORING');
    await queued(mon.id, convMon, spToUtc(0, 0, 28));
    // sábado 10:00: monitoramento (06–20, todos os dias) sai; o gerador segue esperando
    const sat = await repo.claimDue(spToUtc(10, 0, 31), 10);
    expect(sat.map((d) => d.offerId)).toEqual([mon.id]);
    await prisma.offerDispatch.update({ where: { id: sat[0]!.id }, data: { status: 'SENT', chatMessageId: 'm', claimedAt: spToUtc(10, 0, 31) } });
    // segunda 10:00 (02/11): dia útil, dentro da faixa
    expect((await repo.claimDue(spToUtc(10, 0, 33), 10)).map((d) => d.offerId)).toEqual([gen.id]);
  });

  it('scheduledAt explícito ignora a janela do gerador (D3)', async () => {
    await reset();
    await prisma.offerGeneratorConfig.upsert({ where: { tenantId }, create: { tenantId, windowStartMinute: 480, windowEndMinute: 1080, weekdaysMask: 0b0111110 }, update: { windowStartMinute: 480, windowEndMinute: 1080, weekdaysMask: 0b0111110 } });
    const gen = await offer('GENERATOR');
    await prisma.offer.update({ where: { id: gen.id }, data: { scheduledAt: spToUtc(22, 0, 31) } });
    await queued(gen.id, convGen, spToUtc(22, 0, 31));
    expect((await repo.claimDue(spToUtc(22, 0, 31), 10)).map((d) => d.offerId)).toEqual([gen.id]);
  });
});

describe('claimDue — janela da configuração de ORIGEM (sessão cruzada)', () => {
  it('oferta capturada na sessão A (06–20) disparada pela sessão B: vale a janela de A; B sem config não libera', async () => {
    await reset();
    const b = await prisma.session.create({ data: { tenantId, name: 'B', status: 'CONNECTED' } });
    const convB = (await prisma.chatConversation.create({ data: { tenantId, sessionId: b.id, isGroup: true, groupJid: 'b' } })).id;
    const cfgA = await prisma.groupMonitorConfig.findFirstOrThrow({ where: { tenantId, sessionId } });
    const mon = await prisma.offer.create({ data: { tenantId, provider: 'AMAZON', sourceUrl: 'x', affiliateUrl: 'x', text: 'x', status: 'SENDING', origin: 'MONITORING', monitorConfigId: cfgA.id } });
    await prisma.offerDispatch.create({ data: { tenantId, offerId: mon.id, conversationId: convB, sessionId: b.id, notBefore: spToUtc(5), status: 'QUEUED', gapSeconds: 0 } });
    expect(await repo.claimDue(spToUtc(21, 30), 10)).toEqual([]);
    expect((await repo.claimDue(spToUtc(9), 10)).map((d) => d.offerId)).toEqual([mon.id]);
    await prisma.offerDispatch.deleteMany({ where: { sessionId: b.id } });
    await prisma.chatConversation.delete({ where: { id: convB } });
    await prisma.session.delete({ where: { id: b.id } });
  });

  it('oferta antiga sem monitorConfigId usa a configuração da sessão que envia', async () => {
    await reset();
    const mon = await offer('MONITORING');
    await queued(mon.id, convMon, spToUtc(5));
    expect(await repo.claimDue(spToUtc(21, 30), 10)).toEqual([]);
    expect((await repo.claimDue(spToUtc(9), 10)).map((d) => d.offerId)).toEqual([mon.id]);
  });
});

describe('claimDue — pausa global', () => {
  it('tenant pausado não sai; retomado sai', async () => {
    await reset();
    const gen = await offer('GENERATOR');
    await queued(gen.id, convGen, spToUtc(8));
    await prisma.tenant.update({ where: { id: tenantId }, data: { sendingPausedAt: spToUtc(8) } });
    expect(await repo.claimDue(spToUtc(9), 10)).toEqual([]);
    await prisma.tenant.update({ where: { id: tenantId }, data: { sendingPausedAt: null } });
    expect((await repo.claimDue(spToUtc(9), 10)).map((d) => d.offerId)).toEqual([gen.id]);
  });

  it('tenant suspenso pelo billing não sai e o envio continua QUEUED; reativado sai', async () => {
    await reset();
    const gen = await offer('GENERATOR');
    const d = await queued(gen.id, convGen, spToUtc(8));
    await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    expect(await repo.claimDue(spToUtc(9), 10)).toEqual([]);
    expect((await prisma.offerDispatch.findUnique({ where: { id: d.id } }))?.status).toBe('QUEUED');
    await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });
    expect((await repo.claimDue(spToUtc(9), 10)).map((x) => x.offerId)).toEqual([gen.id]);
  });
});

describe('claimDue — prioridade do gerador na faixa', () => {
  it('gerador vencido sai antes de capturas do monitoramento mais antigas da mesma sessão', async () => {
    await reset();
    const mon = await offer('MONITORING');
    await queued(mon.id, convMon, spToUtc(7));
    const gen = await offer('GENERATOR');
    const g = await queued(gen.id, convGen, spToUtc(8, 50));
    const got = await repo.claimDue(spToUtc(9), 10);
    expect(got.map((d) => d.id)).toEqual([g.id]);
  });

  it('gerador agendado no futuro não fura: a captura vencida sai', async () => {
    await reset();
    const mon = await offer('MONITORING');
    const m = await queued(mon.id, convMon, spToUtc(7));
    const gen = await offer('GENERATOR');
    await queued(gen.id, convGen, spToUtc(9, 30));
    const got = await repo.claimDue(spToUtc(9), 10);
    expect(got.map((d) => d.id)).toEqual([m.id]);
  });
});

describe('openSessionIds', () => {
  it('sessões com QUEUED de oferta SENDING, sem repetir', async () => {
    await reset();
    const gen = await offer('GENERATOR');
    await queued(gen.id, convGen, spToUtc(8));
    await queued(gen.id, convMon, spToUtc(8, 5));
    expect(await repo.openSessionIds(tenantId)).toEqual([sessionId]);
    expect(await repo.openSessionIds('outro')).toEqual([]);
  });
});

describe('openNotBefore', () => {
  it('QUEUED e SENDING de oferta SENDING já iniciada e não vencida, em ordem; ignora PAUSED, agendada no futuro e vencida', async () => {
    await reset();
    const a = await offer('GENERATOR');
    await queued(a.id, convGen, spToUtc(8, 10));
    const d = await queued(a.id, convMon, spToUtc(8));
    await prisma.offerDispatch.update({ where: { id: d.id }, data: { status: 'SENDING', claimToken: 'c', claimedAt: spToUtc(8) } });
    const paused = await offer('GENERATOR');
    await prisma.offer.update({ where: { id: paused.id }, data: { status: 'PAUSED' } });
    await queued(paused.id, convGen, spToUtc(8, 20));
    const future = await offer('GENERATOR');
    await prisma.offer.update({ where: { id: future.id }, data: { scheduledAt: spToUtc(12) } });
    await queued(future.id, convGen, spToUtc(12));
    const expired = await offer('MONITORING');
    await prisma.offer.update({ where: { id: expired.id }, data: { expiresAt: spToUtc(7) } });
    await queued(expired.id, convMon, spToUtc(8, 30));
    expect(await repo.openNotBefore(tenantId, sessionId, spToUtc(8, 5))).toEqual([spToUtc(8), spToUtc(8, 10)]);
    expect(await repo.openNotBefore(tenantId, 'outra', spToUtc(8, 5))).toEqual([]);
  });

  it('com origem, só envios de ofertas dessa origem', async () => {
    await reset();
    const gen = await offer('GENERATOR');
    await queued(gen.id, convGen, spToUtc(8, 10));
    const mon = await offer('MONITORING');
    await queued(mon.id, convMon, spToUtc(8));
    expect(await repo.openNotBefore(tenantId, sessionId, spToUtc(8, 5), 'GENERATOR')).toEqual([spToUtc(8, 10)]);
    expect(await repo.openNotBefore(tenantId, sessionId, spToUtc(8, 5))).toEqual([spToUtc(8), spToUtc(8, 10)]);
  });
});

describe('laneState — piso após SEND_TIMEOUT', () => {
  it('SEND_TIMEOUT conta como último envio em claimedAt + hold (120 s): prévia nunca antes da liberação', async () => {
    await reset();
    const a = await offer('GENERATOR');
    const d = await queued(a.id, convGen, spToUtc(8));
    await prisma.offerDispatch.update({ where: { id: d.id }, data: { status: 'FAILED', failureReason: 'SEND_TIMEOUT', claimedAt: spToUtc(8), gapSeconds: 60 } });
    const st = await repo.laneState(tenantId, sessionId, spToUtc(8, 1));
    expect(st.lastClaimedAt).toEqual(new Date(spToUtc(8).getTime() + 120_000));
  });
});

describe('skipExpired', () => {
  it('fecha em lote QUEUED de oferta SENDING vencida; válida e PAUSED ficam', async () => {
    await reset();
    const paused = await offer('GENERATOR');
    await prisma.offer.update({ where: { id: paused.id }, data: { status: 'PAUSED', expiresAt: spToUtc(7) } });
    await queued(paused.id, convGen, spToUtc(6, 6));
    const old = await offer('MONITORING');
    await prisma.offer.update({ where: { id: old.id }, data: { expiresAt: spToUtc(7) } });
    await queued(old.id, convMon, spToUtc(6));
    await queued(old.id, convGen, spToUtc(6, 2));
    const ok = await offer('GENERATOR');
    await queued(ok.id, convGen, spToUtc(6, 4));
    expect(await repo.skipExpired(spToUtc(8))).toBe(2);
    const rows = await prisma.offerDispatch.findMany({ where: { tenantId }, orderBy: { notBefore: 'asc' } });
    expect(rows.map((r) => [r.status, r.failureReason])).toEqual([['SKIPPED', 'OFFER_EXPIRED'], ['SKIPPED', 'OFFER_EXPIRED'], ['QUEUED', null], ['QUEUED', null]]);
  });
});

/** Sessão do Postgres em outro fuso: `ALTER DATABASE` + reconexão (o pool abre conexões novas). */
async function sessionTimeZone(tz: string) {
  // Banco da própria conexão (INTEGRATION_DATABASE_URL), nunca um nome fixo: bancos isolados por agente
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS "db"`;
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" SET timezone = '${tz}'`);
  await prisma.$disconnect();
}

/** Mesma janela e instante: o SQL do claim responde igual a `isWithinPostingWindow`. */
async function sqlOpen(w: PostingWindow, now: Date): Promise<boolean> {
  const wd = weekdayInZone(now);
  const open = postingWindowOpenSql('g', zoneMinuteSql(now), 1 << wd, 1 << ((wd + 6) % 7));
  const rows = await prisma.$queryRaw<{ open: boolean }[]>(Prisma.sql`SELECT ${open} AS "open"
    FROM (VALUES (${w.startMinute}::int, ${w.endMinute}::int, ${w.weekdaysMask}::int)) AS g("windowStartMinute", "windowEndMinute", "weekdaysMask")`);
  return rows[0]!.open;
}

describe('paridade TS × SQL da janela (virada de dia, início 0, início 1440, noturna)', () => {
  afterAll(async () => {
    await sessionTimeZone('UTC');
  });

  const FRI = 1 << 5;
  const windows: PostingWindow[] = [
    { startMinute: 1320, endMinute: 120, weekdaysMask: FRI },
    { startMinute: 0, endMinute: 360, weekdaysMask: FRI },
    { startMinute: 1440, endMinute: 360, weekdaysMask: FRI },
    { startMinute: 1440, endMinute: 360, weekdaysMask: 127 },
    { startMinute: 360, endMinute: 1440, weekdaysMask: FRI },
    { startMinute: 1320, endMinute: 0, weekdaysMask: FRI },
    { startMinute: 0, endMinute: 1440, weekdaysMask: FRI },
  ];
  // 29/10 = quinta, 30 = sexta, 31 = sábado (horário de SP)
  const instants = [
    spToUtc(23, 59, 29), spToUtc(0, 0, 30), spToUtc(0, 30, 30), spToUtc(1, 59, 30), spToUtc(2, 0, 30), spToUtc(5, 59, 30),
    spToUtc(6, 0, 30), spToUtc(12, 0, 30), spToUtc(21, 59, 30), spToUtc(22, 0, 30), spToUtc(23, 59, 30), spToUtc(0, 0, 31),
    spToUtc(1, 0, 31), spToUtc(5, 59, 31),
  ];

  it.each(['UTC', 'Asia/Tokyo', 'America/Los_Angeles'])('sessão em %s: mesmas entradas, mesmo resultado', async (tz) => {
    await sessionTimeZone(tz);
    const [{ zone }] = await prisma.$queryRaw<{ zone: string }[]>`SELECT current_setting('TimeZone') AS "zone"`;
    expect(zone).toBe(tz);
    for (const w of windows) {
      for (const at of instants) {
        expect({ w, at: at.toISOString(), open: await sqlOpen(w, at) }).toEqual({ w, at: at.toISOString(), open: isWithinPostingWindow(at, w) });
      }
    }
  });

  it('início 1440 (24:00 → 06:00 de sexta): sexta 01:00 abre nos dois, sábado 01:00 não', async () => {
    const w = { startMinute: 1440, endMinute: 360, weekdaysMask: FRI };
    expect([await sqlOpen(w, spToUtc(1, 0, 30)), isWithinPostingWindow(spToUtc(1, 0, 30), w)]).toEqual([true, true]);
    expect([await sqlOpen(w, spToUtc(1, 0, 31)), isWithinPostingWindow(spToUtc(1, 0, 31), w)]).toEqual([false, false]);
  });
});

describe('claimDue — sessão do Postgres fora de UTC', () => {
  afterAll(async () => {
    await sessionTimeZone('UTC');
    await prisma.groupMonitorConfig.updateMany({ where: { tenantId, sessionId }, data: { windowStartMinute: 360, windowEndMinute: 1200, weekdaysMask: 127 } });
  });

  it('janela 06–20 em SP vale igual com a sessão em Asia/Tokyo', async () => {
    await sessionTimeZone('Asia/Tokyo');
    await reset();
    await prisma.groupMonitorConfig.updateMany({ where: { tenantId, sessionId }, data: { windowStartMinute: 360, windowEndMinute: 1200, weekdaysMask: 127 } });
    const mon = await offer('MONITORING');
    await queued(mon.id, convMon, spToUtc(5, 0, 28));
    // 05:30 em SP (= 17:30 em Tóquio, dentro de 06–20 se o fuso vazasse): fora
    expect(await repo.claimDue(spToUtc(5, 30, 28), 10)).toEqual([]);
    expect((await repo.claimDue(spToUtc(7, 0, 28), 10)).map((d) => d.offerId)).toEqual([mon.id]);
  });
});

describe('claimDue — exclusões de sessão (concorrência 2, entrega B)', () => {
  let session2 = '';
  let conv2 = '';
  /** Uma oferta por envio: (offerId, conversationId) é único. */
  async function queuedIn(_offerId: string, conversationId: string, sid: string | null, notBefore: Date) {
    const offerId = (await offer('GENERATOR')).id;
    return prisma.offerDispatch.create({ data: { tenantId, offerId, conversationId, sessionId: sid, notBefore, status: 'QUEUED', gapSeconds: 0 } });
  }
  beforeAll(async () => {
    session2 = (await prisma.session.create({ data: { tenantId, name: 'S2', status: 'CONNECTED' } })).id;
    conv2 = (await prisma.chatConversation.create({ data: { tenantId, sessionId: session2, isGroup: true, groupJid: 'g2' } })).id;
  });

  it('vazio = claim de sempre; sessão excluída fica de fora; legado sem sessão nunca é excluído', async () => {
    await reset();
    const gen = await offer('GENERATOR');
    await queuedIn(gen.id, convGen, sessionId, spToUtc(8));
    await queuedIn(gen.id, conv2, session2, spToUtc(8));
    await queuedIn(gen.id, convMon, null, spToUtc(8));
    const got = await repo.claimDue(spToUtc(9), 10, { excludeSessionIds: [sessionId] });
    expect(got.map((d) => d.sessionId).sort()).toEqual([null, session2].sort());
    expect(got.every((d) => !!d.claimToken)).toBe(true);
    // A excluída continua QUEUED e sai num claim sem exclusão
    const rest = await repo.claimDue(spToUtc(9), 10, { excludeSessionIds: [] });
    expect(rest.map((d) => d.sessionId)).toEqual([sessionId]);
  });

  it('sessão com sender pendente segue excluída mesmo após o hold de 120 s do SEND_TIMEOUT', async () => {
    await reset();
    const gen = await offer('GENERATOR');
    const t = await queuedIn(gen.id, convGen, sessionId, spToUtc(8));
    await prisma.offerDispatch.update({ where: { id: t.id }, data: { status: 'FAILED', failureReason: 'SEND_TIMEOUT', claimedAt: spToUtc(8) } });
    await queuedIn(gen.id, convGen, sessionId, spToUtc(8, 1));
    // 1 min depois: o hold do banco ainda segura; 3 min depois: só a exclusão segura
    expect(await repo.claimDue(new Date(spToUtc(8).getTime() + 60_000), 10)).toEqual([]);
    const after = new Date(spToUtc(8).getTime() + 180_000);
    expect(await repo.claimDue(after, 10, { excludeSessionIds: [sessionId] })).toEqual([]);
    expect((await repo.claimDue(after, 10)).map((d) => d.sessionId)).toEqual([sessionId]);
  });

  it('dois claims concorrentes: sessões distintas, um token por item, nada perdido', async () => {
    await reset();
    const gen = await offer('GENERATOR');
    await queuedIn(gen.id, convGen, sessionId, spToUtc(8));
    await queuedIn(gen.id, conv2, session2, spToUtc(8));
    const [a, b] = await Promise.all([
      repo.claimDue(spToUtc(9), 1, { excludeSessionIds: [] }),
      repo.claimDue(spToUtc(9), 1, { excludeSessionIds: [] }),
    ]);
    const all = [...a, ...b];
    expect(all).toHaveLength(2);
    expect(new Set(all.map((d) => d.sessionId)).size).toBe(2);
    expect(new Set(all.map((d) => d.claimToken)).size).toBe(2);
    const rows = await prisma.offerDispatch.findMany({ where: { tenantId } });
    expect(rows.every((r) => r.status === 'SENDING' && r.claimToken)).toBe(true);
  });

  it('preserva prioridade de quem esperava a sessão e o agendamento futuro', async () => {
    await reset();
    const gen = await offer('GENERATOR');
    await queuedIn(gen.id, convGen, sessionId, spToUtc(8));
    const waiting = await queuedIn(gen.id, convGen, sessionId, spToUtc(8, 5));
    await prisma.offerDispatch.update({ where: { id: waiting.id }, data: { waitingSessionSince: spToUtc(7) } });
    await queuedIn(gen.id, conv2, session2, spToUtc(10));
    const got = await repo.claimDue(spToUtc(9), 10, { excludeSessionIds: ['outra-sessao'] });
    expect(got.map((d) => d.id)).toEqual([waiting.id]);
  });
});

describe('claimDue — só o dono da sessão envia (dois processos)', () => {
  const repoA = new PrismaOfferDispatchRepository(prisma, 'worker-a');
  const repoB = new PrismaOfferDispatchRepository(prisma, 'worker-b');
  const sid: Record<'s1' | 's2' | 's3' | 's4', string> = { s1: '', s2: '', s3: '', s4: '' };
  const conv: Record<string, string> = {};
  const lease = (owner: string, minutes: number) => ({ ownerWorkerId: owner, leaseUntil: new Date(Date.now() + minutes * 60_000) });

  beforeAll(async () => {
    const data = { s1: lease('worker-a', 10), s2: lease('worker-b', 10), s3: {}, s4: lease('worker-b', -10) };
    for (const k of Object.keys(data) as (keyof typeof data)[]) {
      sid[k] = (await prisma.session.create({ data: { tenantId, name: k, status: 'CONNECTED', ...data[k] } })).id;
      conv[k] = (await prisma.chatConversation.create({ data: { tenantId, sessionId: sid[k], isGroup: true, groupJid: `own-${k}` } })).id;
    }
  });
  afterAll(async () => { await sessionTimeZone('UTC'); });

  /** Um envio QUEUED vencido por sessão + um sem sessão; devolve o rótulo de cada id. */
  async function seed(): Promise<Map<string, string>> {
    await reset();
    const labels = new Map<string, string>();
    // Vencido há 1 dia: `notBefore <= $now` (timestamp × timestamptz) desloca pelo fuso da conexão; aqui só o lease importa
    const past = new Date(Date.now() - 86_400_000);
    for (const k of ['s1', 's2', 's3', 's4', 'null'] as const) {
      const offerId = (await offer('GENERATOR')).id;
      const d = await prisma.offerDispatch.create({ data: {
        tenantId, offerId, conversationId: k === 'null' ? convGen : conv[k]!, sessionId: k === 'null' ? null : sid[k],
        notBefore: past, status: 'QUEUED', gapSeconds: 0,
      } });
      labels.set(d.id, k);
    }
    return labels;
  }
  const names = (labels: Map<string, string>, got: { id: string }[]) => got.map((d) => labels.get(d.id)).sort();

  // Fuso da conexão ≠ UTC: comparar `timestamp` com `now()` cru deslocaria o lease em horas
  it.each(['Asia/Tokyo', 'America/Sao_Paulo'])('A pega S1/S3/S4/sem sessão e nunca S2; B só sobra S2 (TimeZone %s)', async (tz) => {
    await sessionTimeZone(tz);
    let labels = await seed();
    expect(names(labels, await repoA.claimDue(new Date(), 10))).toEqual(['null', 's1', 's3', 's4']);
    expect(names(labels, await repoB.claimDue(new Date(), 10))).toEqual(['s2']);

    labels = await seed();
    expect(names(labels, await repoB.claimDue(new Date(), 10))).toEqual(['null', 's2', 's3', 's4']);
    expect(names(labels, await repoA.claimDue(new Date(), 10))).toEqual(['s1']);
  });

  it('caminho concorrente (excludeSessionIds) respeita o dono; disputa simultânea não cruza', async () => {
    await sessionTimeZone('Asia/Tokyo');
    let labels = await seed();
    expect(names(labels, await repoA.claimDue(new Date(), 10, { excludeSessionIds: [sid.s3] }))).toEqual(['null', 's1', 's4']);
    expect(names(labels, await repoB.claimDue(new Date(), 10, { excludeSessionIds: [] }))).toEqual(['s2', 's3']);

    labels = await seed();
    const [a, b] = await Promise.all([
      repoA.claimDue(new Date(), 10, { excludeSessionIds: [] }),
      repoB.claimDue(new Date(), 10, { excludeSessionIds: [] }),
    ]);
    expect(names(labels, a)).not.toContain('s2');
    expect(names(labels, b)).not.toContain('s1');
    expect([...names(labels, a), ...names(labels, b)].sort()).toEqual(['null', 's1', 's2', 's3', 's4']);
  });
});
