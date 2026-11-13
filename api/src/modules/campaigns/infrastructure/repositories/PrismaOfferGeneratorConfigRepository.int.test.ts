import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaOfferGeneratorConfigRepository } from './PrismaOfferGeneratorConfigRepository';

/**
 * Sessão apagada (soft delete) continua nas tabelas da configuração (o cascade é só do delete físico).
 * A leitura ignora a sessão e os grupos dela; nada é apagado: a limpeza é o próximo salvar.
 */
const repo = new PrismaOfferGeneratorConfigRepository(prisma);
const stamp = Date.now();
const ids = { t: '', live: '', gone: '', gLive: '', gGone: '' };

async function group(sessionId: string, jid: string) {
  return (await prisma.chatConversation.create({
    data: { tenantId: ids.t, sessionId, isGroup: true, groupJid: jid, groupName: `G ${jid}`, externalChatId: `${jid}@g.us` },
  })).id;
}

beforeAll(async () => {
  ids.t = (await prisma.tenant.create({ data: { name: 'int cfg', slug: `int-ogc-${stamp}` } })).id;
  ids.gone = (await prisma.session.create({ data: { tenantId: ids.t, name: 'Apagada' } })).id;
  ids.live = (await prisma.session.create({ data: { tenantId: ids.t, name: 'Viva' } })).id;
  ids.gGone = await group(ids.gone, '111');
  ids.gLive = await group(ids.live, '222');
  await repo.save({
    tenantId: ids.t, sessionIds: [ids.gone, ids.live], intervalMinSeconds: 60, intervalMaxSeconds: 120, dispatchOrder: 'SEQUENTIAL',
    windowStartMinute: 0, windowEndMinute: 1440, weekdaysMask: 127, conversationIds: [ids.gGone, ids.gLive],
  });
  await prisma.session.update({ where: { id: ids.gone }, data: { deletedAt: new Date() } });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: ids.t } });
  await prisma.$disconnect();
});

describe('configuração do gerador com sessão apagada', () => {
  it('find devolve só as sessões não apagadas, na ordem', async () => {
    const config = await repo.find(ids.t);
    expect(config?.sessionIds).toEqual([ids.live]);
    expect(config?.intervalMinSeconds).toBe(60);
  });

  it('listGroups não devolve grupo de sessão apagada', async () => {
    expect((await repo.listGroups(ids.t)).map((g) => g.conversationId)).toEqual([ids.gLive]);
  });

  it('a leitura não apaga nada: as linhas seguem no banco até o próximo salvar', async () => {
    expect(await prisma.offerGeneratorConfigSession.count({ where: { tenantId: ids.t } })).toBe(2);
    expect(await prisma.offerDestination.count({ where: { tenantId: ids.t } })).toBe(2);
  });

  it('só sessões apagadas: config existe, sem sessão nem grupo', async () => {
    await prisma.session.update({ where: { id: ids.live }, data: { deletedAt: new Date() } });
    expect((await repo.find(ids.t))?.sessionIds).toEqual([]);
    expect(await repo.listGroups(ids.t)).toEqual([]);
  });
});
