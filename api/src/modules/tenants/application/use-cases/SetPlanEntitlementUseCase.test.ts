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

  it('chave numérica: inteiro na faixa grava, propaga e audita na mesma transação', async () => {
    const { uc, presets, audit, calls } = setup();
    const out = await uc.execute({ ...ok, key: 'offer_hunter_finds_per_day', value: 25 });
    expect(out).toEqual({ planSlug: 'COPYSYNC_PRO', key: 'offer_hunter_finds_per_day', value: 25, tenantsUpdated: 3 });
    expect(presets.setForPlan).toHaveBeenCalledWith({ planSlug: 'COPYSYNC_PRO', key: 'offer_hunter_finds_per_day', value: 25 });
    expect(audit.create).toHaveBeenCalledWith({
      userId: 'admin-1',
      action: 'PLAN_ENTITLEMENT_CHANGED',
      meta: { planSlug: 'COPYSYNC_PRO', key: 'offer_hunter_finds_per_day', value: 25, tenantsUpdated: 3 },
    });
    expect(calls).toEqual(['begin', 'preset', 'audit', 'commit']);
  });

  it('chave numérica: limites da faixa (0 e 100) aceitos', async () => {
    const { uc, presets } = setup();
    await uc.execute({ ...ok, key: 'offer_hunter_finds_per_day', value: 0 });
    await uc.execute({ ...ok, key: 'offer_hunter_finds_per_day', value: 100 });
    expect(presets.setForPlan).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['fora da faixa (acima)', 'offer_hunter_finds_per_day', 101],
    ['fora da faixa (negativo)', 'offer_hunter_finds_per_day', -1],
    ['não inteiro', 'offer_hunter_finds_per_day', 2.5],
    ['boolean em chave numérica', 'offer_hunter_finds_per_day', true],
    ['número em chave booleana', 'marketplace_shein_enabled', 1],
    ['número em chave booleana (caçador)', 'offer_hunter_enabled', 0],
  ] as const)('%s → ValidationError 400, sem abrir transação', async (_label, key, value) => {
    const { uc, transaction } = setup();
    const err = await uc.execute({ ...ok, key, value }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.statusCode).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('chave booleana nova do caçador grava como as demais', async () => {
    const { uc, presets } = setup();
    await uc.execute({ ...ok, key: 'offer_hunter_enabled', value: true });
    expect(presets.setForPlan).toHaveBeenCalledWith({ planSlug: 'COPYSYNC_PRO', key: 'offer_hunter_enabled', value: true });
  });

  it('falha na auditoria propaga (a transação desfaz o preset)', async () => {
    const { uc, calls } = setup({ auditFails: true });
    await expect(uc.execute(ok)).rejects.toThrow('db down');
    expect(calls).not.toContain('commit');
  });
});
