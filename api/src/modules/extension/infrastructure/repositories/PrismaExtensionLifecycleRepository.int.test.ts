import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaExtensionLifecycleRepository } from './PrismaExtensionLifecycleRepository';
import { PrismaExtensionInstallationRepository } from './PrismaExtensionInstallationRepository';
import { RecordStoreClickUseCase } from '../../application/use-cases/RecordStoreClickUseCase';
import { RecordLifecycleSignalUseCase } from '../../application/use-cases/RecordLifecycleSignalUseCase';
import { RecordUninstallUseCase } from '../../application/use-cases/RecordUninstallUseCase';

/** Clique → INSTALL → vínculo → desinstalação contra Postgres descartável, com outbox e seq por cliente. */
const repo = new PrismaExtensionLifecycleRepository(prisma);
const installations = new PrismaExtensionInstallationRepository(prisma);
const stamp = Date.now();
const clientKey = `central-${stamp}`;
const ids = { tenant: '', user: '' };
const inst = randomUUID();
const EXT_ID = 'nokcbnoicaebghagbhlfcbepheohdgnd';

beforeAll(async () => {
  ids.tenant = (await prisma.tenant.create({ data: { name: 'int ext', slug: `int-ext-${stamp}`, billingCustomerId: clientKey } })).id;
  ids.user = (await prisma.user.create({ data: { email: `ext-${stamp}@int.test`, name: 'Int' } })).id;
});

afterAll(async () => {
  await prisma.hubOutboxEvent.deleteMany({ where: { clientKey } });
  await prisma.hubOutboxSequence.deleteMany({ where: { clientKey } });
  await prisma.extensionLifecycleEvent.deleteMany({ where: { userId: ids.user } });
  await prisma.extensionInstallation.deleteMany({ where: { installationId: inst } });
  await prisma.user.delete({ where: { id: ids.user } });
  await prisma.tenant.delete({ where: { id: ids.tenant } });
  await prisma.$disconnect();
});

describe('PrismaExtensionLifecycleRepository', () => {
  it('clique deduplica por usuário em 60 s, inclusive em paralelo', async () => {
    const t0 = new Date();
    const uc = new RecordStoreClickUseCase(repo, () => t0);
    const results = await Promise.all([1, 2, 3].map(() => uc.execute({ userId: ids.user, tenantId: ids.tenant, source: 'settings' })));
    expect(results.filter(r => r.recorded)).toHaveLength(1);
    expect(await prisma.extensionLifecycleEvent.count({ where: { userId: ids.user, type: 'STORE_CLICK' } })).toBe(1);
  });

  it('INSTALL público cria linha sem dono; repetido é idempotente', async () => {
    const uc = new RecordLifecycleSignalUseCase(installations, repo);
    const sig = { installationId: inst, type: 'INSTALL', version: '3.3.0', channel: 'cs-ext', dedupeKey: 'INSTALL', extensionId: EXT_ID };
    expect(await uc.execute(sig)).toEqual({ created: true });
    expect(await uc.execute(sig)).toEqual({ created: false });
    expect((await installations.findById(inst))?.userId).toBeNull();
  });

  it('vínculo atribui o clique à instalação (uma vez só)', async () => {
    await prisma.extensionInstallation.update({ where: { installationId: inst }, data: { userId: ids.user } });
    await prisma.extensionSession.create({
      data: {
        tokenHash: `h-${stamp}`, userId: ids.user, installationId: inst, mlTenantId: ids.tenant, extVersion: '3.3.0',
        expiresAt: new Date(Date.now() + 60_000), absoluteExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const since = new Date(Date.now() - 3_600_000);
    const click = await repo.attributeStoreClick(ids.user, inst, since);
    expect(click?.id).toBeTruthy();
    expect(await repo.attributeStoreClick(ids.user, inst, since)).toBeNull();
    const row = await prisma.extensionLifecycleEvent.findUnique({ where: { id: click!.id } });
    expect(row?.installationId).toBe(inst);
    expect(await repo.findTenantForInstallation(inst)).toBe(ids.tenant);
  });

  it('desinstalação + pesquisa: status, feedback e outbox com seq contínuo por cliente', async () => {
    const uc = new RecordUninstallUseCase(installations, repo);
    await uc.execute({ installationId: inst, feedback: { reasons: ['slow'], comment: 'ok' } });
    await uc.execute({ installationId: inst, feedback: { reasons: ['price'] } }); // reenvio substitui
    expect((await installations.findById(inst))?.status).toBe('UNINSTALLED');
    const fb = await prisma.extensionUninstallFeedback.findUnique({ where: { installationId: inst } });
    expect(fb?.reasons).toEqual(['price']);
    const outbox = await prisma.hubOutboxEvent.findMany({ where: { clientKey }, orderBy: { seq: 'asc' } });
    expect(outbox.map(o => [o.seq, (o.payload as { event: string }).event, o.installationId])).toEqual([
      [1, 'STORE_CLICK', null],
      [2, 'UNINSTALL', inst],
      [3, 'UNINSTALL_FEEDBACK', inst],
    ]);
    expect(outbox.every(o => o.type === 'extension.lifecycle')).toBe(true);
  });
});
