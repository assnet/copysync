import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaCapturedOfferRepository } from './PrismaCapturedOfferRepository';

const repo = new PrismaCapturedOfferRepository(prisma);
const NOW = new Date('2026-10-28T12:00:00.000Z');
const days = (n: number) => new Date(NOW.getTime() - n * 24 * 3600_000);
let tenantId = '';
let sessionId = '';
let configId = '';

beforeAll(async () => {
  const t = await prisma.tenant.create({ data: { name: 'int', slug: `int-cap-${Date.now()}` } });
  tenantId = t.id;
  const s = await prisma.session.create({ data: { tenantId, name: 'S', status: 'CONNECTED' } });
  sessionId = s.id;
  const c = await prisma.groupMonitorConfig.create({ data: { tenantId, sessionId } });
  configId = c.id;
  const row = (id: string, data: object) => prisma.capturedOffer.create({
    data: { tenantId, sessionId, configId, sourceExternalMessageId: id, sourceText: 'x', ...data },
  });
  await row('m1', { status: 'SKIPPED', reason: 'CREDENTIAL_MISSING', marketplace: 'SHOPEE', capturedAt: days(1) });
  await row('m2', { status: 'SKIPPED', reason: 'CREDENTIAL_MISSING', marketplace: 'SHOPEE', capturedAt: days(2) });
  await row('m3', { status: 'SKIPPED', reason: 'CREDENTIAL_MISSING', marketplace: 'AMAZON', capturedAt: days(9) });
  await row('m4', { status: 'SKIPPED', reason: 'EXPIRED', marketplace: 'MERCADO_LIVRE', capturedAt: days(1) });
  await row('m5', { status: 'FAILED', reason: 'CREDENTIAL_MISSING', marketplace: 'MERCADO_LIVRE', capturedAt: days(1) });
});
afterAll(async () => {
  await prisma.capturedOffer.deleteMany({ where: { tenantId } });
  await prisma.groupMonitorConfig.deleteMany({ where: { tenantId } });
  await prisma.session.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('PrismaCapturedOfferRepository.listRecentMissingProviders', () => {
  it('DISTINCT por loja, só SKIPPED/CREDENTIAL_MISSING dentro da janela, por tenant', async () => {
    expect(await repo.listRecentMissingProviders(tenantId, days(7))).toEqual(['SHOPEE']);
    expect(await repo.listRecentMissingProviders(tenantId, days(10))).toEqual(expect.arrayContaining(['SHOPEE', 'AMAZON']));
    expect(await repo.listRecentMissingProviders('outro-tenant', days(10))).toEqual([]);
  });
});
