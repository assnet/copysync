import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { countDistinctBroadcastGroups } from '../../domain/services/broadcastGroupUnion';
import { PrismaBroadcastGroupUsageReader } from './PrismaBroadcastGroupUsageReader';

/** União gerador ⋃ monitoramentos (BG-01/BG-04): sem vazamento entre tenants, grupo nos dois usos conta 1. */
const reader = new PrismaBroadcastGroupUsageReader(prisma);
const stamp = Date.now();
const ids = { a: '', b: '', waA: '', tgA: '', goneA: '', waB: '', g1: '', g2: '', tg1: '', gone1: '', g3: '', gB: '' };

async function group(tenantId: string, sessionId: string, jid: string, name: string) {
  return (await prisma.chatConversation.create({
    data: { tenantId, sessionId, isGroup: true, groupJid: jid, groupName: name, externalChatId: `${jid}@g.us` },
  })).id;
}

beforeAll(async () => {
  ids.a = (await prisma.tenant.create({ data: { name: 'int A', slug: `int-bgu-a-${stamp}` } })).id;
  ids.b = (await prisma.tenant.create({ data: { name: 'int B', slug: `int-bgu-b-${stamp}` } })).id;
  ids.waA = (await prisma.session.create({ data: { tenantId: ids.a, name: 'WA A' } })).id;
  ids.tgA = (await prisma.session.create({ data: { tenantId: ids.a, name: 'TG A', engine: 'telegram' } })).id;
  ids.goneA = (await prisma.session.create({ data: { tenantId: ids.a, name: 'Apagada', deletedAt: new Date() } })).id;
  ids.waB = (await prisma.session.create({ data: { tenantId: ids.b, name: 'WA B' } })).id;

  ids.g1 = await group(ids.a, ids.waA, '111', 'Ofertas 1');
  ids.g2 = await group(ids.a, ids.waA, '222', 'Ofertas 2');
  ids.tg1 = await group(ids.a, ids.tgA, '-100333', 'Canal TG');
  ids.gone1 = await group(ids.a, ids.goneA, '444', 'Morto');
  ids.g3 = await group(ids.a, ids.waA, '555', 'Do monitor apagado');
  ids.gB = await group(ids.b, ids.waB, '111', 'Grupo B');

  // gerador A: g1 (também no monitor), tg1, gone1 (sessão apagada → fora)
  await prisma.offerDestination.createMany({
    data: [ids.g1, ids.tg1, ids.gone1].map((conversationId) => ({ tenantId: ids.a, conversationId })),
  });
  const monA = await prisma.groupMonitorConfig.create({ data: { tenantId: ids.a, sessionId: ids.waA } });
  await prisma.broadcastGroup.createMany({
    data: [
      { tenantId: ids.a, sessionId: ids.waA, configId: monA.id, conversationId: ids.g1, groupJid: '111', position: 0 },
      { tenantId: ids.a, sessionId: ids.waA, configId: monA.id, conversationId: ids.g2, groupJid: '222', position: 1 },
    ],
  });
  // monitor da sessão apagada: não conta (grupo em sessão viva)
  const monGone = await prisma.groupMonitorConfig.create({ data: { tenantId: ids.a, sessionId: ids.goneA } });
  await prisma.broadcastGroup.create({
    data: { tenantId: ids.a, sessionId: ids.waA, configId: monGone.id, conversationId: ids.g3, groupJid: '555', position: 0 },
  });

  await prisma.offerDestination.create({ data: { tenantId: ids.b, conversationId: ids.gB } });
  const monB = await prisma.groupMonitorConfig.create({ data: { tenantId: ids.b, sessionId: ids.waB } });
  await prisma.broadcastGroup.create({
    data: { tenantId: ids.b, sessionId: ids.waB, configId: monB.id, conversationId: ids.gB, groupJid: '111', position: 0 },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [ids.a, ids.b] } } });
  await prisma.$disconnect();
});

describe('listRows', () => {
  it('une gerador e monitor do tenant, ignora sessão apagada e não vaza outro tenant', async () => {
    const rows = await reader.listRows(ids.a);
    expect(rows.map((r) => `${r.use}|${r.groupJid}`).sort()).toEqual(
      ['generator|-100333', 'generator|111', `monitor:${ids.waA}|111`, `monitor:${ids.waA}|222`].sort(),
    );
    expect(rows.every((r) => r.conversationId !== ids.gB)).toBe(true);
    expect(rows.find((r) => r.conversationId === ids.tg1)?.engine).toBe('telegram');
    expect(countDistinctBroadcastGroups(rows, (r) => r.engine)).toEqual({ whatsapp: 2, telegram: 1 });
  });

  it('exceptGenerator e exceptMonitorSessionId tiram o próprio uso', async () => {
    const noGen = await reader.listRows(ids.a, { exceptGenerator: true });
    expect(noGen.every((r) => r.use !== 'generator')).toBe(true);
    expect(noGen).toHaveLength(2);
    const noMon = await reader.listRows(ids.a, { exceptMonitorSessionId: ids.waA });
    expect(noMon.map((r) => r.use)).toEqual(['generator', 'generator']);
  });

  it('tenant B só vê o próprio grupo, mesmo com JID igual ao de A', async () => {
    const rows = await reader.listRows(ids.b);
    expect(rows.map((r) => [r.conversationId, r.use])).toEqual([[ids.gB, 'generator'], [ids.gB, `monitor:${ids.waB}`]]);
  });
});

describe('listCatalog', () => {
  it('um item por grupo distinto com todos os usos', async () => {
    const items = await reader.listCatalog(ids.a);
    expect(items.map((i) => [i.title, i.usedBy])).toEqual([
      ['Canal TG', ['generator']],
      ['Ofertas 1', ['generator', `monitor:${ids.waA}`]],
      ['Ofertas 2', [`monitor:${ids.waA}`]],
    ]);
    expect(items[1]).toMatchObject({ conversationId: ids.g1, sessionId: ids.waA, sessionName: 'WA A', engine: 'baileys', groupJid: '111' });
    const b = await reader.listCatalog(ids.b);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ conversationId: ids.gB, usedBy: ['generator', `monitor:${ids.waB}`] });
  });
});

describe('removeEverywhere', () => {
  it('conversa de outro tenant → found false e nada muda', async () => {
    expect(await reader.removeEverywhere(ids.b, ids.g1)).toEqual({ found: false, removed: 0 });
    expect(await prisma.broadcastGroup.count({ where: { conversationId: ids.g1 } })).toBe(1);
    expect(await prisma.offerDestination.count({ where: { conversationId: ids.g1 } })).toBe(1);
  });

  it('conversa que não é grupo → found false', async () => {
    const dm = await prisma.chatConversation.create({
      data: { tenantId: ids.a, sessionId: ids.waA, isGroup: false, externalChatId: `5511999${stamp}@s.whatsapp.net` },
    });
    expect(await reader.removeEverywhere(ids.a, dm.id)).toEqual({ found: false, removed: 0 });
  });

  it('tira do gerador e do monitor numa vez; segunda chamada é idempotente', async () => {
    expect(await reader.removeEverywhere(ids.a, ids.g1)).toEqual({ found: true, removed: 2 });
    expect(await prisma.broadcastGroup.count({ where: { tenantId: ids.a, conversationId: ids.g1 } })).toBe(0);
    expect(await prisma.offerDestination.count({ where: { tenantId: ids.a, conversationId: ids.g1 } })).toBe(0);
    expect(await reader.removeEverywhere(ids.a, ids.g1)).toEqual({ found: true, removed: 0 });

    const items = await reader.listCatalog(ids.a);
    expect(items.map((i) => i.title)).toEqual(['Canal TG', 'Ofertas 2']);
    // tenant B com o mesmo JID intocado
    expect((await reader.listCatalog(ids.b))[0]?.usedBy).toEqual(['generator', `monitor:${ids.waB}`]);
  });
});
