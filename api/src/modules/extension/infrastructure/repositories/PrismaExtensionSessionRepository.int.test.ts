import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaExtensionSessionRepository } from './PrismaExtensionSessionRepository';
import { PrismaExtensionInstallationRepository } from './PrismaExtensionInstallationRepository';

/** Consentimento por marketplace (ML × Shein) e re-vínculo contra Postgres descartável. */
const repo = new PrismaExtensionSessionRepository(prisma);
const stamp = Date.now();
const inst = randomUUID();
const ids = { t1: '', t2: '', user: '' };
const later = (h: number) => new Date(Date.now() + h * 3600_000);

const issue = (mlTenantId: string, mlConsentAt: Date | null) =>
  repo.issue({
    userId: ids.user, installationId: inst, mlTenantId, tokenHash: `h-${randomUUID()}`, extVersion: '3.4.0',
    mlConsentAt, sheinConsentAt: null, expiresAt: later(24), absoluteExpiresAt: later(48),
  });

beforeAll(async () => {
  ids.t1 = (await prisma.tenant.create({ data: { name: 'int s1', slug: `int-ses1-${stamp}` } })).id;
  ids.t2 = (await prisma.tenant.create({ data: { name: 'int s2', slug: `int-ses2-${stamp}` } })).id;
  ids.user = (await prisma.user.create({ data: { email: `ses-${stamp}@int.test`, name: 'Int' } })).id;
  await new PrismaExtensionInstallationRepository(prisma).upsert({
    installationId: inst, extensionId: 'nokcbnoicaebghagbhlfcbepheohdgnd', channel: 'cs-ext', userId: ids.user, version: '3.4.0',
  });
});

afterAll(async () => {
  await prisma.extensionSession.deleteMany({ where: { userId: ids.user } });
  await prisma.extensionInstallation.deleteMany({ where: { installationId: inst } });
  await prisma.user.delete({ where: { id: ids.user } });
  await prisma.tenant.deleteMany({ where: { id: { in: [ids.t1, ids.t2] } } });
  await prisma.$disconnect();
});

describe('PrismaExtensionSessionRepository — consentimento por marketplace', () => {
  it('grant/revoke/hasConsent da Shein não mexem no ML (e vice-versa)', async () => {
    const s = await issue(ids.t1, new Date());
    expect(s.sheinConsentAt).toBeNull();
    expect(await repo.hasConsent(s.id, 'SHEIN')).toBe(false);
    expect(await repo.hasConsent(s.id, 'ML')).toBe(true);

    expect(await repo.grantConsent('SHEIN', ids.user, inst, ids.t2, new Date())).toBe(false); // outro tenant
    expect(await repo.grantConsent('SHEIN', ids.user, inst, ids.t1, new Date())).toBe(true);
    expect(await repo.hasConsent(s.id, 'SHEIN')).toBe(true);
    expect((await repo.findByTokenHash(s.tokenHash))!.sheinConsentAt).toBeInstanceOf(Date);

    expect(await repo.revokeConsentForTenant('SHEIN', ids.t1)).toBe(1);
    expect(await repo.hasConsent(s.id, 'SHEIN')).toBe(false);
    expect(await repo.hasConsent(s.id, 'ML')).toBe(true);

    // métodos ML delegam
    expect(await repo.revokeMlConsentForTenant(ids.t1)).toBe(1);
    expect(await repo.hasConsent(s.id, 'ML')).toBe(false);
    expect(await repo.grantMlConsent(ids.user, inst, ids.t1, new Date())).toBe(true);
    expect(await repo.hasConsent(s.id, 'ML')).toBe(true);
  });

  it('sessão revogada não tem consentimento', async () => {
    const s = await issue(ids.t1, null);
    await repo.grantConsent('SHEIN', ids.user, inst, ids.t1, new Date());
    await repo.revoke(s.id);
    expect(await repo.hasConsent(s.id, 'SHEIN')).toBe(false);
    expect(await repo.grantConsent('SHEIN', ids.user, inst, ids.t1, new Date())).toBe(false);
  });

  it('re-vínculo a outro tenant zera sheinConsentAt', async () => {
    const s = await issue(ids.t1, null);
    await repo.grantConsent('SHEIN', ids.user, inst, ids.t1, new Date());
    expect(await repo.hasConsent(s.id, 'SHEIN')).toBe(true);
    const relinked = await issue(ids.t2, null);
    expect(relinked.id).toBe(s.id);
    expect(relinked).toMatchObject({ mlTenantId: ids.t2, sheinConsentAt: null, revokedAt: null });
    expect(await repo.hasConsent(s.id, 'SHEIN')).toBe(false);
  });
});
