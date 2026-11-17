import { describe, expect, it, vi } from 'vitest';
import { GetSaverOverviewUseCase, SAVER_CONFIG_DEFAULTS, type GetSaverOverviewDeps } from './GetSaverOverviewUseCase';
import type { SaverActor } from './saverActor';
import { SaverExportFormat } from '../../domain/enums/SaverEnums';

const NOW = new Date('2026-11-17T12:00:00Z');

function make(opts: { snapshot?: Record<string, unknown>; grant?: boolean; queueRunning?: boolean; hasProduct?: boolean } = {}) {
  const deps = {
    entitlements: { readAll: vi.fn(async () => opts.snapshot ?? {}) },
    products: { has: vi.fn(async () => opts.hasProduct ?? false) },
    groups: { countActive: vi.fn(async (t: string) => (t === 't1' ? 3 : 99)) },
    memberships: { countDistinctContacts: vi.fn(async (t: string) => (t === 't1' ? 40 : 999)) },
    queue: { countScansSince: vi.fn(async (t: string) => (t === 't1' ? 5 : 77)) },
    configs: { findByTenant: vi.fn(async () => null) },
    exportGrants: { hasGrant: vi.fn(async () => opts.grant ?? false) },
    queueRunning: () => opts.queueRunning ?? false,
    now: () => NOW,
  } satisfies GetSaverOverviewDeps;
  return { deps, uc: new GetSaverOverviewUseCase(deps) };
}

const actor = (role: SaverActor['role']): SaverActor => ({ tenantId: 't1', userId: 'u1', role });

describe('GetSaverOverviewUseCase', () => {
  it('chave ausente = limite 0', async () => {
    const { uc } = make();
    const r = await uc.execute(actor('ADMIN'));
    expect(r.groups).toEqual({ used: 3, limit: 0, remaining: 0 });
    expect(r.contacts.limit).toBe(0);
    expect(r.groupScansPerDay.limit).toBe(0);
    expect(r.autoRefreshEnabled).toBe(false);
  });

  it('null explícito = ilimitado', async () => {
    const { uc } = make({ snapshot: { saver_groups: null, saver_contacts: null, saver_group_scans_per_day: 50 } });
    const r = await uc.execute(actor('ADMIN'));
    expect(r.groups).toEqual({ used: 3, limit: null, remaining: null });
    expect(r.contacts).toEqual({ used: 40, limit: null, remaining: null });
    expect(r.groupScansPerDay).toEqual({ used: 5, limit: 50, remaining: 45 });
  });

  it('uso conta só o tenant informado e janela de 24 h', async () => {
    const { uc, deps } = make();
    await uc.execute(actor('ADMIN'));
    expect(deps.groups.countActive).toHaveBeenCalledWith('t1');
    expect(deps.memberships.countDistinctContacts).toHaveBeenCalledWith('t1');
    expect(deps.queue.countScansSince).toHaveBeenCalledWith('t1', new Date('2026-11-16T12:00:00Z'));
    expect(deps.entitlements.readAll).toHaveBeenCalledWith('t1');
  });

  it('permissões de ADMIN', async () => {
    const { uc, deps } = make();
    const r = await uc.execute(actor('ADMIN'));
    expect(r.permissions).toEqual({ view: true, extract: true, export: true, configure: true });
    expect(deps.exportGrants.hasGrant).not.toHaveBeenCalled();
  });

  it('permissões de OPERATOR sem liberação', async () => {
    const { uc } = make();
    const r = await uc.execute(actor('OPERATOR'));
    expect(r.permissions).toEqual({ view: true, extract: true, export: false, configure: false });
  });

  it('OPERATOR com exportação liberada', async () => {
    const { uc, deps } = make({ grant: true });
    const r = await uc.execute(actor('OPERATOR'));
    expect(r.permissions).toEqual({ view: true, extract: true, export: true, configure: false });
    expect(deps.exportGrants.hasGrant).toHaveBeenCalledWith('t1', 'u1');
  });

  it('queueRunning reflete a flag', async () => {
    expect((await make({ queueRunning: true }).uc.execute(actor('ADMIN'))).queueRunning).toBe(true);
    expect((await make({ queueRunning: false }).uc.execute(actor('ADMIN'))).queueRunning).toBe(false);
  });

  it('config padrão sem linha; config salva quando existe', async () => {
    const { uc, deps } = make();
    expect((await uc.execute(actor('ADMIN'))).config).toEqual(SAVER_CONFIG_DEFAULTS);
    deps.configs.findByTenant.mockResolvedValueOnce({
      tenantId: 't1', namePrefix: 'X ', excludeAdminsByDefault: true, defaultFormat: SaverExportFormat.VCARD,
      autoRefresh: true, updatedAt: NOW,
    } as never);
    expect((await uc.execute(actor('ADMIN'))).config).toEqual({
      namePrefix: 'X ', excludeAdminsByDefault: true, defaultFormat: SaverExportFormat.VCARD, autoRefresh: true,
    });
  });

  describe('SAVER-47: piloto do super admin', () => {
    it('super admin sem o produto: limites do SAVER_MAX e pilot = true', async () => {
      const { uc, deps } = make({ hasProduct: false });
      const r = await uc.execute(actor('SUPER_ADMIN'));
      expect(r.pilot).toBe(true);
      expect(r.groups).toEqual({ used: 3, limit: null, remaining: null });
      expect(r.contacts).toEqual({ used: 40, limit: null, remaining: null });
      expect(r.groupScansPerDay).toEqual({ used: 5, limit: 500, remaining: 495 });
      expect(r.autoRefreshEnabled).toBe(true);
      expect(deps.products.has).toHaveBeenCalledWith('t1', 'SAVER');
    });

    it('super admin com o produto (LITE) respeita os entitlements do tenant', async () => {
      const { uc } = make({ hasProduct: true, snapshot: { saver_groups: 10, saver_contacts: 10_000, saver_group_scans_per_day: 20 } });
      const r = await uc.execute(actor('SUPER_ADMIN'));
      expect(r.pilot).toBe(false);
      expect(r.groups.limit).toBe(10);
      expect(r.groupScansPerDay).toEqual({ used: 5, limit: 20, remaining: 15 });
    });

    it('ADMIN nunca é piloto: sem plano, limites 0 e produto nem consultado', async () => {
      const { uc, deps } = make({ hasProduct: false });
      const r = await uc.execute(actor('ADMIN'));
      expect(r.pilot).toBe(false);
      expect(r.groups.limit).toBe(0);
      expect(deps.products.has).not.toHaveBeenCalled();
    });
  });
});
