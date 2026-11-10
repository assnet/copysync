import { describe, expect, it, vi } from 'vitest';
import { SetPlanEntitlementUseCase, type PlanEntitlementTransaction } from './SetPlanEntitlementUseCase';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';

function setup(opts: { auditFails?: boolean } = {}) {
  const calls: string[] = [];
  const presets = { listByKeys: vi.fn(), setForPlan: vi.fn(async () => { calls.push('preset'); return { tenantsUpdated: 3 }; }) };
  const audit = {
    create: vi.fn(async () => {
      calls.push('audit');
      if (opts.auditFails) throw new Error('db down');
    }),
  };
  const transaction = vi.fn(async (fn) => {
    calls.push('begin');
    const r = await fn({ presets, audit });
    calls.push('commit');
    return r;
  }) as unknown as PlanEntitlementTransaction & ReturnType<typeof vi.fn>;
  return { uc: new SetPlanEntitlementUseCase(transaction), presets, audit, transaction, calls };
}

const ok = { planSlug: 'COPYSYNC_PRO', key: 'marketplace_shein_enabled', value: true, actorUserId: 'admin-1' };

describe('SetPlanEntitlementUseCase', () => {
  it('grava preset e auditoria dentro da mesma transação', async () => {
    const { uc, presets, audit, calls } = setup();
    const out = await uc.execute(ok);
    expect(out).toEqual({ planSlug: 'COPYSYNC_PRO', key: 'marketplace_shein_enabled', value: true, tenantsUpdated: 3 });
    expect(presets.setForPlan).toHaveBeenCalledWith({ planSlug: 'COPYSYNC_PRO', key: 'marketplace_shein_enabled', value: true });
    expect(audit.create).toHaveBeenCalledWith({
      userId: 'admin-1',
      action: 'PLAN_ENTITLEMENT_CHANGED',
      meta: { planSlug: 'COPYSYNC_PRO', key: 'marketplace_shein_enabled', value: true, tenantsUpdated: 3 },
    });
    expect(calls).toEqual(['begin', 'preset', 'audit', 'commit']);
  });

  it('desligar grava false', async () => {
    const { uc, presets } = setup();
    await uc.execute({ ...ok, value: false });
    expect(presets.setForPlan).toHaveBeenCalledWith(expect.objectContaining({ value: false }));
  });

  it('chave fora da allowlist → ValidationError 400, sem abrir transação', async () => {
    const { uc, transaction } = setup();
    const err = await uc.execute({ ...ok, key: 'storefront_enabled' }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.statusCode).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('plano desconhecido → ValidationError 400, sem abrir transação', async () => {
    const { uc, transaction } = setup();
    const err = await uc.execute({ ...ok, planSlug: 'pro' }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('falha na auditoria propaga (a transação desfaz o preset)', async () => {
    const { uc, calls } = setup({ auditFails: true });
    await expect(uc.execute(ok)).rejects.toThrow('db down');
    expect(calls).not.toContain('commit');
  });
});
