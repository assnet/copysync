import { describe, expect, it, vi } from 'vitest';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import {
  InfraCostMonthUnavailableError,
  InfraCostSettingsConflictError,
  InvalidInfraCostSettingsError,
} from '../../../../shared/errors/internal/InfraCostErrors';
import type { IWorkerScalingSettingsProvider } from '../../../sessions/domain/contracts/IWorkerScalingSettingsProvider';
import type { WorkerScalingSettings } from '../../../sessions/domain/services/workerScalingSettings';
import type { IInfraCostSettingsRepository, InfraCostSettingsRecord } from '../../domain/contracts/IInfraCostSettingsRepository';
import { defaultInfraCostSettings } from '../../domain/services/infraCostSettings';
import { GetInfraCostSettingsUseCase } from './GetInfraCostSettingsUseCase';
import { UpdateInfraCostSettingsUseCase } from './UpdateInfraCostSettingsUseCase';
import { GetInfraCostSummaryUseCase } from './GetInfraCostSummaryUseCase';

const SAVED_AT = new Date('2026-11-10T10:00:00.000Z');
const NOW = new Date('2026-11-12T15:00:00.000Z');

function repo(record: InfraCostSettingsRecord | null = null): IInfraCostSettingsRepository & { save: ReturnType<typeof vi.fn> } {
  return {
    get: vi.fn(async () => record),
    save: vi.fn(async (value, actorId) => ({ value, updatedAt: SAVED_AT, updatedById: actorId })),
  };
}
const audit = (): IAuditLogRepository & { create: ReturnType<typeof vi.fn> } => ({ create: vi.fn(async () => {}) });

describe('GetInfraCostSettingsUseCase', () => {
  it('sem linha: valores iniciais, origem default, updatedAt null', async () => {
    const out = await new GetInfraCostSettingsUseCase(repo()).execute();
    expect(out).toEqual({ settings: defaultInfraCostSettings(), origin: 'default', updatedAt: null });
  });

  it('linha inválida: default com o updatedAt real (PUT não dá 409)', async () => {
    const out = await new GetInfraCostSettingsUseCase(repo({ value: { x: 1 }, updatedAt: SAVED_AT, updatedById: null })).execute();
    expect(out.origin).toBe('default');
    expect(out.updatedAt).toBe(SAVED_AT.toISOString());
  });

  it('linha válida: origem saved', async () => {
    const value = defaultInfraCostSettings();
    value.workspace.planLabel = 'Pro';
    const out = await new GetInfraCostSettingsUseCase(repo({ value, updatedAt: SAVED_AT, updatedById: 'u' })).execute();
    expect(out.origin).toBe('saved');
    expect(out.settings.workspace.planLabel).toBe('Pro');
  });
});

describe('UpdateInfraCostSettingsUseCase', () => {
  it('valida, grava com expectedUpdatedAt e audita antes/depois', async () => {
    const r = repo();
    const a = audit();
    const after = defaultInfraCostSettings();
    after.items[0].monthlyUsd = 30;
    const out = await new UpdateInfraCostSettingsUseCase(r, a).execute({
      settings: after, expectedUpdatedAt: null, actorUserId: 'admin-1',
    });
    expect(r.save).toHaveBeenCalledWith(after, 'admin-1', null);
    expect(a.create).toHaveBeenCalledWith({
      userId: 'admin-1',
      action: 'INFRA_COST_SETTINGS_CHANGED',
      meta: { before: defaultInfraCostSettings(), after },
    });
    expect(out).toEqual({ settings: after, origin: 'saved', updatedAt: SAVED_AT.toISOString() });
  });

  it('campo inválido: 400 com field, sem gravar nem auditar', async () => {
    const r = repo();
    const a = audit();
    const bad = defaultInfraCostSettings() as unknown as { items: { monthlyUsd: unknown }[] };
    bad.items[1].monthlyUsd = -1;
    const err = await new UpdateInfraCostSettingsUseCase(r, a)
      .execute({ settings: bad, expectedUpdatedAt: null, actorUserId: 'a' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidInfraCostSettingsError);
    expect((err as InvalidInfraCostSettingsError).meta).toEqual({ field: 'items[1].monthlyUsd' });
    expect(r.save).not.toHaveBeenCalled();
    expect(a.create).not.toHaveBeenCalled();
  });

  it('expectedUpdatedAt inválido: 400 no campo', async () => {
    const err = await new UpdateInfraCostSettingsUseCase(repo(), audit())
      .execute({ settings: defaultInfraCostSettings(), expectedUpdatedAt: 'ontem', actorUserId: 'a' })
      .catch((e: unknown) => e);
    expect((err as InvalidInfraCostSettingsError).meta).toEqual({ field: 'expectedUpdatedAt' });
  });

  it('conflito propaga 409 sem auditar', async () => {
    const r = repo();
    r.save.mockRejectedValueOnce(new InfraCostSettingsConflictError());
    const a = audit();
    await expect(new UpdateInfraCostSettingsUseCase(r, a).execute({
      settings: defaultInfraCostSettings(), expectedUpdatedAt: SAVED_AT.toISOString(), actorUserId: 'a',
    })).rejects.toBeInstanceOf(InfraCostSettingsConflictError);
    expect(a.create).not.toHaveBeenCalled();
  });
});

describe('GetInfraCostSummaryUseCase', () => {
  function setup(extra: Partial<ConstructorParameters<typeof GetInfraCostSummaryUseCase>[0]> = {}) {
    let scaling: WorkerScalingSettings = {
      maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 50, alertOccupancyRatio: 0.8,
    } as WorkerScalingSettings;
    const provider: IWorkerScalingSettingsProvider = {
      current: () => ({ value: scaling, origin: {} as never }),
      refresh: async () => {},
      start: () => {},
      stop: () => {},
    };
    const live = {
      read: vi.fn(async () => ({ sessionsConnected: 3, sessionsCapacity: 40, sessionsSampledAt: NOW, workerInstances: 1 })),
      workerInstancesInHour: vi.fn(async () => null),
    };
    const capacity = { readByPlan: vi.fn(async () => []) };
    const uc = new GetInfraCostSummaryUseCase({ settings: repo(), live, capacity, scaling: provider, now: () => NOW, ...extra });
    return { uc, live, setScaling: (s: Partial<WorkerScalingSettings>) => { scaling = { ...scaling, ...s }; } };
  }

  it('mês corrente (UTC) por padrão, foto do momento', async () => {
    const { uc, live } = setup();
    const out = await uc.execute();
    expect(out.month).toBe('2026-11');
    expect(out.generatedAt).toBe(NOW);
    expect(out.calculation.basis).toBe('snapshot');
    expect(live.read).toHaveBeenCalledWith(NOW);
    expect(out.calculation.totals.total.usd).toBe(120.25);
    // sem override de cotação na configuração inicial
    expect(out.calculation.fx).toBeNull();
    expect(out.calculation.warnings).toContainEqual({ code: 'fx_missing' });
  });

  it('usa a cotação gravada pelo job (PTAX) e vira last_known quando a busca de hoje falhou', async () => {
    const saved = { referenceDate: new Date('2026-11-11T00:00:00Z'), rate: 5.4321, source: 'ptax' as const, fetchedAt: new Date('2026-11-11T16:31:00Z') };
    const fxRates = { latestFxRate: vi.fn(async () => saved) };
    const ok = await setup({ fxRates }).uc.execute();
    expect(fxRates.latestFxRate).toHaveBeenCalledWith(new Date('2026-11-12T00:00:00Z'));
    expect(ok.calculation.fx).toMatchObject({ rate: 5.4321, referenceDate: '2026-11-11', source: 'ptax', stale: false });

    const failedToday = { referenceDay: '2026-11-12', attempts: 1, lastAttemptAt: NOW, ok: false };
    const fxFetchState = { get: vi.fn(async () => failedToday), save: vi.fn() };
    const failed = await setup({ fxRates, fxFetchState }).uc.execute();
    expect(failed.calculation.fx).toMatchObject({ rate: 5.4321, source: 'last_known' });

    fxFetchState.get.mockResolvedValue({ ...failedToday, referenceDay: '2026-11-11' });
    expect((await setup({ fxRates, fxFetchState }).uc.execute()).calculation.fx?.source).toBe('ptax');
  });

  it('sem leitor do mês: outro mês = 400 INFRA_COST_MONTH_UNAVAILABLE sem ler nada', async () => {
    const { uc, live } = setup();
    await expect(uc.execute({ month: '2026-10' })).rejects.toBeInstanceOf(InfraCostMonthUnavailableError);
    expect(live.read).not.toHaveBeenCalled();
    await expect(uc.execute({ month: '2026-11' })).resolves.toMatchObject({ month: '2026-11' });
  });

  describe('modo horas (COST-11/12)', () => {
    const H = 3_600_000;
    const NOV = new Date('2026-11-01T00:00:00Z');
    const OCT = new Date('2026-10-01T00:00:00Z');
    const hours = (start: Date, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        hour: new Date(start.getTime() + i * H), renderKey: 'worker' as const, plan: '1c-2g', instances: 1, diskGb: null, suspended: false,
      }));
    const tenants = [{ tenantId: 't1', planSlug: 'COPYSYNC_PRO', connectedHours: 100, contractedAvg: 2 }];
    const empty = { resourceHours: [], bandwidthGb: null, buildMinutes: null, tenants: [] };
    const usageOf = (byMonth: Record<string, typeof empty | { resourceHours: ReturnType<typeof hours>; bandwidthGb: null; buildMinutes: null; tenants: typeof tenants }>) => ({
      readMonth: vi.fn(async (start: Date) => byMonth[start.toISOString().slice(0, 7)] ?? empty),
    });

    it('mês corrente com snapshot: basis hours, intervalo do mês e projeção', async () => {
      const usage = usageOf({ '2026-11': { resourceHours: hours(NOV, 24), bandwidthGb: null, buildMinutes: null, tenants } });
      const out = await setup({ usage }).uc.execute();
      expect(usage.readMonth).toHaveBeenCalledWith(NOV, new Date('2026-12-01T00:00:00Z'));
      expect(out.calculation.basis).toBe('hours');
      expect(out.calculation.totals.projected).not.toBeNull();
      expect(out.calculation.perSession.connected.sessionHours).toBe(100);
    });

    it('mês corrente sem snapshot: cai na foto do momento', async () => {
      const usage = usageOf({});
      const out = await setup({ usage }).uc.execute({ month: '2026-11' });
      expect(out.calculation.basis).toBe('snapshot');
      expect(out.calculation.totals.total.usd).toBe(120.25);
    });

    it('mês passado: só horas, sem foto de agora; cotação até o último dia do mês', async () => {
      const usage = usageOf({ '2026-10': { resourceHours: hours(OCT, 744), bandwidthGb: null, buildMinutes: null, tenants } });
      const saved = { referenceDate: new Date('2026-10-30T00:00:00Z'), rate: 5.4, source: 'ptax' as const, fetchedAt: new Date('2026-10-30T16:31:00Z') };
      const fxRates = { latestFxRate: vi.fn(async () => saved) };
      const { uc, live } = setup({ usage, fxRates });
      const out = await uc.execute({ month: '2026-10' });
      expect(out.month).toBe('2026-10');
      expect(out.calculation.basis).toBe('hours');
      expect(live.read).not.toHaveBeenCalled();
      expect(fxRates.latestFxRate).toHaveBeenCalledWith(new Date('2026-10-31T00:00:00Z'));
      expect(out.calculation.fx).toMatchObject({ rate: 5.4, source: 'ptax', stale: false });
      // mês cheio: projeção = realizado; worker 744 h × 1 instância = 25
      expect(out.calculation.items.find((i) => i.key === 'worker')?.cost?.usd).toBe(25);
      expect(out.calculation.totals.projected).toEqual(out.calculation.totals.total);
      expect(out.calculation.perSession.connected.unallocatedSessions).toBeNull();
    });

    it('mês passado sem dado e mês futuro: 400 INFRA_COST_MONTH_UNAVAILABLE', async () => {
      const usage = usageOf({});
      const { uc } = setup({ usage });
      await expect(uc.execute({ month: '2026-09' })).rejects.toBeInstanceOf(InfraCostMonthUnavailableError);
      await expect(uc.execute({ month: '2026-12' })).rejects.toBeInstanceOf(InfraCostMonthUnavailableError);
      expect(usage.readMonth).toHaveBeenCalledTimes(1); // futuro não lê
    });
  });

  it('lê o teto do provider a cada chamada (troca entre duas chamadas)', async () => {
    const { uc, setScaling } = setup();
    const first = await uc.execute();
    expect(first.calculation.marginalPerSession?.usd).toBe(0.7813); // 25 ÷ (40 × 0,8)
    setScaling({ maxSessionsPerWorker: 50, alertOccupancyRatio: 0.5 });
    const second = await uc.execute();
    expect(second.calculation.marginalPerSession?.usd).toBe(1); // 25 ÷ (50 × 0,5)
  });
});
