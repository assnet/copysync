import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Repositórios em memória: o use case só orquestra (transação simulada roda o callback direto). */
const mem = vi.hoisted(() => ({
  tenants: [] as Array<{ id: string; planSlug: string | null; status: string }>,
  products: [] as Array<{ tenantId: string; product: string; status: string; planSlug: string | null; source: string }>,
  audits: [] as Array<{ action: string }>,
  env: { PANEL_URL: '', PRODUCT_ACCESS_GATE_MODE: 'enforce' as string },
  logError: vi.fn(),
}));

vi.mock('../../../../shared/database/UnitOfWork', () => ({
  UnitOfWork: class {
    afterCommit() {}
    runInTransaction<T>(fn: (tx: unknown) => Promise<T>) { return fn({}); }
  },
}));
vi.mock('../../infrastructure/repositories/PrismaTenantRepository', () => ({
  PrismaTenantRepository: class { async create(t: { id: string; planSlug: string | null; status: string }) { mem.tenants.push({ id: t.id, planSlug: t.planSlug, status: t.status }); } },
}));
vi.mock('../../infrastructure/repositories/PrismaTenantProductRepository', () => ({
  PrismaTenantProductRepository: class { async upsert(r: (typeof mem.products)[number]) { mem.products.push(r); return r; } },
}));
vi.mock('../../../users/infrastructure/repositories/PrismaUserRepository', () => ({
  PrismaUserRepository: class {
    async findByEmail() { return null; }
    async create() {}
    async createUserTenant() {}
  },
}));
vi.mock('../../../users/infrastructure/repositories/PrismaUserInviteRepository', () => ({
  PrismaUserInviteRepository: class { async create() {} },
}));
vi.mock('../../../../shared/audit/PrismaAuditLogRepository', () => ({
  PrismaAuditLogRepository: class { async create(a: { action: string }) { mem.audits.push(a); } },
}));
vi.mock('../../../../shared/config/env', () => ({ env: mem.env }));
vi.mock('../../../../shared/logger/logger', () => ({
  logger: { child: () => ({ error: mem.logError, warn: vi.fn(), info: vi.fn() }), error: vi.fn() },
}));

import { ProvisionTenantUseCase, type ProvisionTenantInput } from './ProvisionTenantUseCase';

const base: ProvisionTenantInput = { name: 'Ana', slug: 'ana', owner: { email: 'ana@x.com', name: 'Ana' }, billingCustomerId: 'c1', origin: 'BILLING_WEBHOOK' };
const run = (input: Partial<ProvisionTenantInput>) => new ProvisionTenantUseCase({ send: vi.fn() } as never).execute({ ...base, ...input });

beforeEach(() => {
  mem.tenants.length = 0;
  mem.products.length = 0;
  mem.audits.length = 0;
  mem.env.PRODUCT_ACCESS_GATE_MODE = 'enforce';
  mem.logError.mockReset();
});

describe('ProvisionTenantUseCase', () => {
  it('sem initialProducts: plano no tenant e nenhuma linha de produto (como antes)', async () => {
    await run({ planSlug: 'COPYSYNC_PRO' });
    expect(mem.tenants).toEqual([expect.objectContaining({ planSlug: 'COPYSYNC_PRO', status: 'ACTIVE' })]);
    expect(mem.products).toEqual([]);
    expect(mem.audits.map((a) => a.action)).toEqual(['TENANT_CREATED']);
    expect(mem.logError).not.toHaveBeenCalled();
  });

  it('só Afiliados em initialProducts: igual a hoje', async () => {
    await run({ planSlug: 'COPYSYNC_PRO', initialProducts: [{ product: 'AFFILIATES', planSlug: 'COPYSYNC_PRO' }] });
    expect(mem.tenants[0]!.planSlug).toBe('COPYSYNC_PRO');
    expect(mem.products).toEqual([]);
  });

  it('produto novo: planSlug nulo, produto ativo e Afiliados inativo, sem linha CHAT', async () => {
    const out = await run({ initialProducts: [{ product: 'SAVER', planSlug: 'SAVER_PRO' }] });
    expect(mem.tenants[0]!.planSlug).toBeNull();
    expect(mem.products).toEqual([
      expect.objectContaining({ tenantId: out.tenantId, product: 'SAVER', status: 'ACTIVE', planSlug: 'SAVER_PRO', source: 'BILLING' }),
      expect.objectContaining({ tenantId: out.tenantId, product: 'AFFILIATES', status: 'INACTIVE', planSlug: null, source: 'BILLING' }),
    ]);
    expect(mem.products.some((p) => p.product === 'CHAT')).toBe(false);
    expect(mem.logError).not.toHaveBeenCalled();
  });

  it.each(['off', 'log'])('produto novo com gate em %s: log de erro', async (mode) => {
    mem.env.PRODUCT_ACCESS_GATE_MODE = mode;
    await run({ initialProducts: [{ product: 'SAVER', planSlug: 'SAVER_LITE' }] });
    expect(mem.logError).toHaveBeenCalledTimes(1);
    expect(mem.products).toHaveLength(2);
  });
});
