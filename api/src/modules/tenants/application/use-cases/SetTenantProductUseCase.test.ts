import { describe, expect, it, vi } from 'vitest';
import { NotFoundError, ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import type { TenantProduct, UpsertTenantProductInput } from '../../domain/contracts/ITenantProductRepository';
import { SetTenantProductUseCase, type SetTenantProductCommand, type TenantProductTransactionScope } from './SetTenantProductUseCase';

function setup(opts: { exists?: boolean; previous?: Partial<TenantProduct> | null; mode?: 'off' | 'log' | 'enforce' } = {}) {
  const calls: string[] = [];
  const upsert = vi.fn(async (i: UpsertTenantProductInput): Promise<TenantProduct> => {
    calls.push('upsert');
    return { ...i, inactiveSince: null, updatedAt: new Date() };
  });
  const scope: TenantProductTransactionScope = {
    tenantExists: async () => opts.exists ?? true,
    products: {
      find: async () => (opts.previous ? ({ status: 'ACTIVE', planSlug: null, ...opts.previous } as TenantProduct) : null),
      upsert,
    },
    applyPlanPreset: vi.fn(async () => { calls.push('preset'); }),
    mergeSharedEntitlements: vi.fn(async () => { calls.push('merge'); }),
    audit: { create: vi.fn(async () => { calls.push('audit'); }) },
  };
  const transaction = vi.fn(async (fn: (s: TenantProductTransactionScope) => Promise<unknown>) => {
    calls.push('begin');
    const r = await fn(scope);
    calls.push('commit');
    return r;
  }) as unknown as ConstructorParameters<typeof SetTenantProductUseCase>[0]['transaction'];
  const invalidate = vi.fn(() => { calls.push('invalidate'); });
  const warn = vi.fn();
  const uc = new SetTenantProductUseCase({ transaction, reader: { invalidate }, gateMode: () => opts.mode ?? 'enforce', warn });
  return { uc, scope, upsert, transaction, invalidate, warn, calls };
}

const cmd = (c: Partial<SetTenantProductCommand> = {}): SetTenantProductCommand =>
  ({ tenantId: 't1', product: 'SAVER', status: 'ACTIVE', planSlug: 'SAVER_PRO', actorUserId: 'admin-1', ...c });

async function rejects400(p: Promise<unknown>) {
  const err = (await p.catch((e: unknown) => e)) as ValidationError;
  expect(err).toBeInstanceOf(ValidationError);
  expect(err.statusCode).toBe(400);
}

describe('SetTenantProductUseCase', () => {
  it('liga produto novo: linha ADMIN, preset, merge, auditoria e depois invalida o cache', async () => {
    const { uc, upsert, scope, calls } = setup();
    const out = await uc.execute(cmd());
    expect(out).toEqual({ tenantId: 't1', product: 'SAVER', status: 'ACTIVE', planSlug: 'SAVER_PRO', source: 'ADMIN' });
    expect(upsert).toHaveBeenCalledWith({ tenantId: 't1', product: 'SAVER', status: 'ACTIVE', planSlug: 'SAVER_PRO', expiresAt: null, source: 'ADMIN' });
    expect(scope.applyPlanPreset).toHaveBeenCalledWith('t1', 'SAVER_PRO');
    expect(scope.audit.create).toHaveBeenCalledWith({
      tenantId: 't1', userId: 'admin-1', action: 'TENANT_PRODUCT_CHANGED',
      meta: { product: 'SAVER', status: 'ACTIVE', planSlug: 'SAVER_PRO', previousStatus: null, previousPlanSlug: null, source: 'ADMIN' },
    });
    expect(calls).toEqual(['begin', 'upsert', 'preset', 'merge', 'audit', 'commit', 'invalidate']);
  });

  it('plano de outro produto → 400 sem transação', async () => {
    const { uc, transaction } = setup();
    await rejects400(uc.execute(cmd({ planSlug: 'COPYSYNC_PRO' })));
    await rejects400(uc.execute(cmd({ product: 'AFFILIATES', planSlug: 'SAVER_LITE' })));
    await rejects400(uc.execute(cmd({ planSlug: 'pro' })));
    expect(transaction).not.toHaveBeenCalled();
  });

  it('ligar produto novo sem plano → 400', async () => {
    const { uc } = setup();
    await rejects400(uc.execute(cmd({ planSlug: null })));
  });

  it('CHAT e produto desconhecido → 400', async () => {
    const { uc } = setup();
    await rejects400(uc.execute(cmd({ product: 'CHAT', planSlug: null })));
    await rejects400(uc.execute(cmd({ product: 'XYZ' })));
  });

  it('desligar Afiliados sem plano: sem preset, com merge; desligar produto novo mantém o plano anterior', async () => {
    const a = setup();
    const out = await a.uc.execute(cmd({ product: 'AFFILIATES', status: 'INACTIVE', planSlug: null }));
    expect(out.status).toBe('INACTIVE');
    expect(a.scope.applyPlanPreset).not.toHaveBeenCalled();
    expect(a.scope.mergeSharedEntitlements).toHaveBeenCalledWith('t1');
    const b = setup({ previous: { status: 'ACTIVE', planSlug: 'SAVER_LITE' } });
    expect((await b.uc.execute(cmd({ status: 'INACTIVE', planSlug: null }))).planSlug).toBe('SAVER_LITE');
    expect(b.scope.applyPlanPreset).not.toHaveBeenCalled();
  });

  it('tenant inexistente → 404 e cache intacto', async () => {
    const { uc, invalidate } = setup({ exists: false });
    await expect(uc.execute(cmd())).rejects.toBeInstanceOf(NotFoundError);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('log error fora de enforce ao ligar produto novo ou desligar Afiliados; nunca em enforce', async () => {
    for (const mode of ['off', 'log'] as const) {
      const s = setup({ mode });
      await s.uc.execute(cmd());
      await s.uc.execute(cmd({ product: 'AFFILIATES', status: 'INACTIVE', planSlug: null }));
      await s.uc.execute(cmd({ product: 'AFFILIATES', status: 'ACTIVE', planSlug: 'COPYSYNC_PRO' }));
      expect(s.warn).toHaveBeenCalledTimes(2);
    }
    const e = setup({ mode: 'enforce' });
    await e.uc.execute(cmd());
    expect(e.warn).not.toHaveBeenCalled();
  });
});
