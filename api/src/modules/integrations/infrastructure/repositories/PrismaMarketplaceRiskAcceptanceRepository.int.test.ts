import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { PrismaMarketplaceRiskAcceptanceRepository } from './PrismaMarketplaceRiskAcceptanceRepository';
import { prismaMarketplaceRiskAcceptTransaction } from '../marketplaceRiskTransaction';
import { AcceptMarketplaceRiskUseCase } from '../../application/use-cases/AcceptMarketplaceRiskUseCase';
import { MARKETPLACE_RISK_NOTICE_VERSION } from '../../domain/services/marketplaceRiskNotice';

const repo = new PrismaMarketplaceRiskAcceptanceRepository();
let tenantA = '';
let tenantB = '';
let userId = '';
let tenantC = '';
let tenantD = '';
let tenantE = '';

beforeAll(async () => {
  const stamp = Date.now();
  tenantA = (await prisma.tenant.create({ data: { name: 'int-a', slug: `int-risk-a-${stamp}` } })).id;
  tenantB = (await prisma.tenant.create({ data: { name: 'int-b', slug: `int-risk-b-${stamp}` } })).id;
  tenantC = (await prisma.tenant.create({ data: { name: 'int-c', slug: `int-risk-c-${stamp}` } })).id;
  tenantD = (await prisma.tenant.create({ data: { name: 'int-d', slug: `int-risk-d-${stamp}` } })).id;
  tenantE = (await prisma.tenant.create({ data: { name: 'int-e', slug: `int-risk-e-${stamp}` } })).id;
  userId = (await prisma.user.create({ data: { email: `risk-${stamp}@int.test`, name: 'int', passwordHash: 'x' } })).id;
});
afterAll(async () => {
  await prisma.marketplaceRiskAcceptance.deleteMany({ where: { tenantId: { in: [tenantA, tenantB, tenantC, tenantD, tenantE] } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: [tenantA, tenantB, tenantC, tenantD, tenantE] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB, tenantC, tenantD, tenantE] } } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('PrismaMarketplaceRiskAcceptanceRepository', () => {
  it('create grava tenant/usuário/versão/idioma/hora; repetido devolve o existente', async () => {
    const before = Date.now();
    const first = await repo.create({ tenantId: tenantA, provider: 'SHEIN', scope: 'AFFILIATE_LINK', noticeVersion: 'v1', acceptedByUserId: userId, locale: 'pt-BR' });
    expect(first.created).toBe(true);
    expect(first.acceptance).toMatchObject({ tenantId: tenantA, provider: 'SHEIN', scope: 'AFFILIATE_LINK', noticeVersion: 'v1', acceptedByUserId: userId, locale: 'pt-BR' });
    expect(first.acceptance.acceptedAt.getTime()).toBeGreaterThanOrEqual(before - 5000);

    const again = await repo.create({ tenantId: tenantA, provider: 'SHEIN', scope: 'AFFILIATE_LINK', noticeVersion: 'v1', acceptedByUserId: userId, locale: 'en' });
    expect(again).toEqual({ acceptance: first.acceptance, created: false });
    expect(await prisma.marketplaceRiskAcceptance.count({ where: { tenantId: tenantA } })).toBe(1);
  });

  it('aceites simultâneos da mesma versão: uma linha, um só created', async () => {
    const input = { tenantId: tenantA, provider: 'SHEIN' as const, scope: 'AFFILIATE_LINK' as const, noticeVersion: 'v-race', acceptedByUserId: userId, locale: 'pt-BR' };
    const results = await Promise.all([repo.create(input), repo.create(input), repo.create(input)]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.acceptance.id)).size).toBe(1);
  });

  it('findCurrent só acha a versão pedida e no próprio tenant', async () => {
    expect(await repo.findCurrent(tenantA, 'SHEIN', 'AFFILIATE_LINK', 'v1')).toMatchObject({ noticeVersion: 'v1' });
    expect(await repo.findCurrent(tenantA, 'SHEIN', 'AFFILIATE_LINK', 'v2')).toBeNull();
    expect(await repo.findCurrent(tenantB, 'SHEIN', 'AFFILIATE_LINK', 'v1')).toBeNull();
  });

  it('mesma versão em escopos diferentes coexiste; findCurrent separa por escopo', async () => {
    const base = { tenantId: tenantE, provider: 'SHEIN' as const, noticeVersion: 'v-scope', acceptedByUserId: userId, locale: 'pt-BR' };
    const link = await repo.create({ ...base, scope: 'AFFILIATE_LINK' });
    const hunter = await repo.create({ ...base, scope: 'OFFER_HUNTER' });
    expect([link.created, hunter.created]).toEqual([true, true]);
    expect(hunter.acceptance.id).not.toBe(link.acceptance.id);
    expect(await repo.findCurrent(tenantE, 'SHEIN', 'OFFER_HUNTER', 'v-scope')).toMatchObject({ id: hunter.acceptance.id, scope: 'OFFER_HUNTER' });
    expect(await repo.findCurrent(tenantE, 'SHEIN', 'AFFILIATE_LINK', 'v-scope')).toMatchObject({ id: link.acceptance.id, scope: 'AFFILIATE_LINK' });
    expect((await repo.create({ ...base, scope: 'OFFER_HUNTER', locale: 'en' })).created).toBe(false);
    expect(await prisma.marketplaceRiskAcceptance.count({ where: { tenantId: tenantE, noticeVersion: 'v-scope' } })).toBe(2);
  });

  it('linha sem scope explícito fica AFFILIATE_LINK (default da coluna)', async () => {
    const raw = await prisma.marketplaceRiskAcceptance.create({
      data: { tenantId: tenantE, provider: 'SHEIN', noticeVersion: 'v-default', acceptedByUserId: userId, locale: 'pt-BR' },
    });
    expect(raw.scope).toBe('AFFILIATE_LINK');
  });

  it('listByTenant isola tenants, mais recente primeiro', async () => {
    await repo.create({ tenantId: tenantA, provider: 'SHEIN', scope: 'AFFILIATE_LINK', noticeVersion: 'v2', acceptedByUserId: userId, locale: 'es-ES' });
    const listA = await repo.listByTenant(tenantA);
    expect(listA.map((a) => a.noticeVersion)).toEqual(['v2', 'v-race', 'v1']);
    expect(listA.every((a) => a.tenantId === tenantA)).toBe(true);
    expect(await repo.listByTenant(tenantB)).toEqual([]);
  });

  it('não expõe update nem delete', () => {
    const r = repo as unknown as Record<string, unknown>;
    expect(r.update).toBeUndefined();
    expect(r.delete).toBeUndefined();
    expect(Object.getOwnPropertyNames(PrismaMarketplaceRiskAcceptanceRepository.prototype).sort()).toEqual(
      ['constructor', 'create', 'findCurrent', 'listByTenant'],
    );
  });

  it('dentro de transação: repetido não aborta o tx (sem P2002)', async () => {
    const input = { tenantId: tenantB, provider: 'SHEIN' as const, scope: 'AFFILIATE_LINK' as const, noticeVersion: 'v-tx', acceptedByUserId: userId, locale: 'pt-BR' };
    const [a, b] = await prisma.$transaction(async (tx) => {
      const r = new PrismaMarketplaceRiskAcceptanceRepository(tx);
      return [await r.create(input), await r.create(input)];
    });
    expect([a.created, b.created]).toEqual([true, false]);
    expect(b.acceptance.id).toBe(a.acceptance.id);
  });
});

describe('AcceptMarketplaceRiskUseCase + transação real', () => {
  const VERSION = MARKETPLACE_RISK_NOTICE_VERSION.SHEIN!;
  const sut = new AcceptMarketplaceRiskUseCase(prismaMarketplaceRiskAcceptTransaction);
  const input = () => ({ tenantId: tenantC, userId, role: 'ADMIN', isSuperAdmin: false, provider: 'SHEIN' as const, scope: 'AFFILIATE_LINK' as const, noticeVersion: VERSION, locale: 'pt-BR' });
  const counts = async () => [
    await prisma.marketplaceRiskAcceptance.count({ where: { tenantId: tenantC } }),
    await prisma.auditLog.count({ where: { tenantId: tenantC, action: 'MARKETPLACE_RISK_ACCEPTED' } }),
  ];
  afterEach(() => { vi.restoreAllMocks(); });

  it('auditoria falha → aceite desfeito; retry grava aceite e auditoria juntos', async () => {
    // Grava a auditoria de verdade no tx e então falha: o rollback tem que levar as duas linhas.
    const real = PrismaAuditLogRepository.prototype.create;
    vi.spyOn(PrismaAuditLogRepository.prototype, 'create').mockImplementationOnce(async function (this: PrismaAuditLogRepository, i) {
      await real.call(this, i);
      throw new Error('audit down');
    });
    await expect(sut.execute(input())).rejects.toThrow('audit down');
    expect(await counts()).toEqual([0, 0]);

    vi.restoreAllMocks();
    await sut.execute(input());
    expect(await counts()).toEqual([1, 1]);
    await sut.execute(input());
    expect(await counts()).toEqual([1, 1]);
  });

  it('dois aceites simultâneos da mesma versão: uma linha, um só created, uma auditoria', async () => {
    const spy = vi.spyOn(PrismaMarketplaceRiskAcceptanceRepository.prototype, 'create');
    const both = [{ ...input(), tenantId: tenantD }, { ...input(), tenantId: tenantD, locale: 'en' }];
    await Promise.all(both.map((i) => sut.execute(i)));
    expect(await Promise.all(spy.mock.results.map((r) => r.value))).toSatisfy(
      (rs: { created: boolean }[]) => rs.filter((r) => r.created).length === 1,
    );
    expect(await prisma.marketplaceRiskAcceptance.count({ where: { tenantId: tenantD } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { tenantId: tenantD, action: 'MARKETPLACE_RISK_ACCEPTED' } })).toBe(1);
  });
});
