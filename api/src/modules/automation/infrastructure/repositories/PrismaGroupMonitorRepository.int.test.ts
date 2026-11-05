import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaGroupMonitorRepository } from './PrismaGroupMonitorRepository';

const repo = new PrismaGroupMonitorRepository(prisma);
let tenantId = '';
let owner = '';
let monitor = '';
let deadMonitor = '';
let convShared = '';
let convOther = '';

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'int', slug: `int-bg-${Date.now()}` } })).id;
  const session = (name: string) => prisma.session.create({ data: { tenantId, name, status: 'CONNECTED' } }).then((s) => s.id);
  [owner, monitor, deadMonitor] = await Promise.all([session('dona'), session('monitor'), session('apagada')]);
  const conv = (jid: string) => prisma.chatConversation.create({ data: { tenantId, sessionId: owner, externalChatId: jid, isGroup: true } }).then((c) => c.id);
  [convShared, convOther] = await Promise.all([conv('shared@g.us'), conv('outro@g.us')]);
});
afterAll(async () => {
  await prisma.broadcastGroup.deleteMany({ where: { tenantId } });
  await prisma.groupMonitorConfig.deleteMany({ where: { tenantId } });
  await prisma.chatConversation.deleteMany({ where: { tenantId } });
  await prisma.session.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('PrismaGroupMonitorRepository.replaceBroadcast', () => {
  it('apaga na transação a linha do grupo presa a monitoramento de sessão apagada; linha viva recusa', async () => {
    const deadCfg = await repo.ensureConfig(tenantId, deadMonitor);
    const cfg = await repo.ensureConfig(tenantId, monitor);
    await repo.replaceBroadcast(tenantId, deadMonitor, deadCfg, [
      { sessionId: owner, groupJid: 'shared@g.us', conversationId: convShared },
      { sessionId: owner, groupJid: 'outro@g.us', conversationId: convOther },
    ]);
    // Monitoramento vivo: a unique continua valendo
    await expect(repo.replaceBroadcast(tenantId, monitor, cfg, [{ sessionId: owner, groupJid: 'shared@g.us', conversationId: convShared }]))
      .rejects.toBeTruthy();
    expect((await repo.tenantGroupJids(tenantId)).broadcast.every((b) => b.live)).toBe(true);

    await prisma.session.update({ where: { id: deadMonitor }, data: { deletedAt: new Date() } });
    await repo.replaceBroadcast(tenantId, monitor, cfg, [{ sessionId: owner, groupJid: 'shared@g.us', conversationId: convShared }]);
    const rows = await prisma.broadcastGroup.findMany({ where: { tenantId }, select: { configId: true, groupJid: true }, orderBy: { groupJid: 'asc' } });
    expect(rows).toEqual([{ configId: deadCfg, groupJid: 'outro@g.us' }, { configId: cfg, groupJid: 'shared@g.us' }]);
    expect(await repo.replaceBroadcast(tenantId, monitor, cfg, [])).toBeUndefined();
    expect(await prisma.broadcastGroup.count({ where: { tenantId, configId: cfg } })).toBe(0);
  });
});
