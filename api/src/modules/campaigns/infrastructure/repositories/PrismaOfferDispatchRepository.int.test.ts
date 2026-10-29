import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaOfferDispatchRepository } from './PrismaOfferDispatchRepository';

/**
 * `claimDue` contra o Postgres real (docs/fila-de-envio.md): janela de operação do monitoramento
 * e pausa global do tenant. Horários em UTC; a janela é em São Paulo (UTC-3).
 */
const repo = new PrismaOfferDispatchRepository(prisma);
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
});
