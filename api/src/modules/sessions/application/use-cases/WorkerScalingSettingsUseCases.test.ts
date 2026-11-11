import { describe, it, expect, vi } from 'vitest';
import { GetWorkerScalingSettingsUseCase, workerScalingEnforcedCheck } from './GetWorkerScalingSettingsUseCase';
import { WORKER_ALIVE_MS } from '../../domain/services/sessionAdoptionPolicy';
import { UpdateWorkerScalingSettingsUseCase } from './UpdateWorkerScalingSettingsUseCase';
import { makeAuditRepo } from './sessionTestFakes';
import type {
  IWorkerScalingSettingsRepository,
  WorkerScalingSettingsRecord,
} from '../../domain/contracts/IWorkerScalingSettingsRepository';
import type { IWorkerScalingSettingsProvider } from '../../domain/contracts/IWorkerScalingSettingsProvider';
import {
  defaultWorkerScalingSettings,
  type WorkerScalingSettings,
} from '../../domain/services/workerScalingSettings';
import {
  InvalidWorkerScalingSettingsError,
  WorkerScalingSettingsConflictError,
} from '../../../../shared/errors/internal/WorkerScalingErrors';

const envDefaults = { maxSessionsPerWorker: 50, maxPendingLoginsPerWorker: 10 };
const deps = (enforced = true) => ({ envDefaults, isEnforced: async () => enforced });
const SAVED_AT = new Date('2026-11-10T12:00:00.000Z');
const NEW_AT = new Date('2026-11-11T08:00:00.000Z');

function makeRepo(record: WorkerScalingSettingsRecord | null) {
  return {
    get: vi.fn(async () => record),
    save: vi.fn(async (value: unknown, actorId: string) => ({ value, updatedAt: NEW_AT, updatedById: actorId })),
  } as IWorkerScalingSettingsRepository & { get: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
}

function makeProvider() {
  return { current: vi.fn(), refresh: vi.fn(async () => undefined), start: vi.fn(), stop: vi.fn() } as
    IWorkerScalingSettingsProvider & { refresh: ReturnType<typeof vi.fn> };
}

const full = (over: Partial<WorkerScalingSettings> = {}): WorkerScalingSettings => ({
  ...defaultWorkerScalingSettings(envDefaults),
  maxSessionsPerWorker: 80,
  ...over,
});

describe('GetWorkerScalingSettingsUseCase', () => {
  it('sem linha: default, origem default, updatedAt null', async () => {
    const view = await new GetWorkerScalingSettingsUseCase(makeRepo(null), deps(false)).execute();
    expect(view.settings).toEqual(defaultWorkerScalingSettings(envDefaults));
    expect(Object.values(view.origin).every((o) => o === 'default')).toBe(true);
    expect(view.updatedAt).toBeNull();
    expect(view.enforced).toBe(false);
  });

  it('com linha: salvo vence campo a campo e updatedAt em ISO', async () => {
    const repo = makeRepo({ value: { maxSessionsPerWorker: 120 }, updatedAt: SAVED_AT, updatedById: 'u0' });
    const view = await new GetWorkerScalingSettingsUseCase(repo, deps()).execute();
    expect(view.settings.maxSessionsPerWorker).toBe(120);
    expect(view.origin.maxSessionsPerWorker).toBe('saved');
    expect(view.origin.maxPendingLoginsPerWorker).toBe('default');
    expect(view.updatedAt).toBe(SAVED_AT.toISOString());
    expect(view.enforced).toBe(true);
  });

  it('linha inválida no banco cai no default mantendo updatedAt', async () => {
    const repo = makeRepo({ value: { maxSessionsPerWorker: 'x' }, updatedAt: SAVED_AT, updatedById: null });
    const view = await new GetWorkerScalingSettingsUseCase(repo, deps()).execute();
    expect(view.settings.maxSessionsPerWorker).toBe(50);
    expect(view.updatedAt).toBe(SAVED_AT.toISOString());
  });
});

describe('UpdateWorkerScalingSettingsUseCase', () => {
  function setup(record: WorkerScalingSettingsRecord | null = null) {
    const repo = makeRepo(record);
    const audit = makeAuditRepo();
    const provider = makeProvider();
    const useCase = new UpdateWorkerScalingSettingsUseCase(repo, audit, provider, deps());
    return { repo, audit, provider, useCase };
  }

  it('salva, audita antes/depois, chama refresh e devolve a forma do GET', async () => {
    const { repo, audit, provider, useCase } = setup({
      value: { maxSessionsPerWorker: 60 },
      updatedAt: SAVED_AT,
      updatedById: 'u0',
    });
    const settings = full();
    const view = await useCase.execute({ settings, expectedUpdatedAt: SAVED_AT.toISOString(), actorUserId: 'u1' });

    expect(repo.save).toHaveBeenCalledWith(settings, 'u1', SAVED_AT);
    expect(audit.create).toHaveBeenCalledWith({
      userId: 'u1',
      action: 'WORKER_SCALING_SETTINGS_CHANGED',
      meta: { before: full({ maxSessionsPerWorker: 60 }), after: settings },
    });
    expect(provider.refresh).toHaveBeenCalledTimes(1);
    expect(audit.create.mock.invocationCallOrder[0]).toBeLessThan(provider.refresh.mock.invocationCallOrder[0]);
    expect(view).toEqual({
      settings,
      origin: Object.fromEntries(Object.keys(settings).map((k) => [k, 'saved'])),
      updatedAt: NEW_AT.toISOString(),
      enforced: true,
    });
  });

  it('primeira gravação passa expectedUpdatedAt null e antes = default', async () => {
    const { repo, audit, useCase } = setup(null);
    await useCase.execute({ settings: full(), expectedUpdatedAt: null, actorUserId: 'u1' });
    expect(repo.save).toHaveBeenCalledWith(full(), 'u1', null);
    expect(audit.create.mock.calls[0][0].meta.before).toEqual(defaultWorkerScalingSettings(envDefaults));
  });

  it.each([
    ['campo desconhecido', { ...full(), extra: 1 }, 'extra'],
    ['fora da faixa', full({ maxSessionsPerWorker: 0 }), 'maxSessionsPerWorker'],
    ['objeto incompleto', { maxSessionsPerWorker: 80 }, 'maxPendingLoginsPerWorker'],
    ['réplicas invertidas', full({ minReplicas: 3, maxReplicas: 2 }), 'maxReplicas'],
  ])('rejeita %s com o campo, sem gravar nem auditar', async (_label, settings, field) => {
    const { repo, audit, provider, useCase } = setup();
    const err = await useCase.execute({ settings, expectedUpdatedAt: null, actorUserId: 'u1' }).catch((e) => e);
    expect(err).toBeInstanceOf(InvalidWorkerScalingSettingsError);
    expect(err.field).toBe(field);
    expect(repo.save).not.toHaveBeenCalled();
    expect(audit.create).not.toHaveBeenCalled();
    expect(provider.refresh).not.toHaveBeenCalled();
  });

  it('rejeita expectedUpdatedAt inválido', async () => {
    const { repo, useCase } = setup();
    const err = await useCase.execute({ settings: full(), expectedUpdatedAt: 'ontem', actorUserId: 'u1' }).catch((e) => e);
    expect(err).toBeInstanceOf(InvalidWorkerScalingSettingsError);
    expect(err.field).toBe('expectedUpdatedAt');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('linha não-objeto: GET cai no default com o updatedAt real e o PUT com ele grava', async () => {
    const repo = makeRepo({ value: 'texto', updatedAt: SAVED_AT, updatedById: null });
    const view = await new GetWorkerScalingSettingsUseCase(repo, deps()).execute();
    expect(view.settings).toEqual(defaultWorkerScalingSettings(envDefaults));
    expect(view.updatedAt).toBe(SAVED_AT.toISOString());
    const uc = new UpdateWorkerScalingSettingsUseCase(repo, makeAuditRepo(), makeProvider(), deps());
    const out = await uc.execute({ settings: full(), expectedUpdatedAt: view.updatedAt, actorUserId: 'u1' });
    expect(repo.save).toHaveBeenCalledWith(full(), 'u1', SAVED_AT);
    expect(out.updatedAt).toBe(NEW_AT.toISOString());
  });

  it('conflito propaga o 409 sem auditoria nem refresh', async () => {
    const { repo, audit, provider, useCase } = setup({ value: {}, updatedAt: NEW_AT, updatedById: 'u2' });
    repo.save.mockRejectedValueOnce(new WorkerScalingSettingsConflictError());
    const err = await useCase
      .execute({ settings: full(), expectedUpdatedAt: SAVED_AT.toISOString(), actorUserId: 'u1' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(WorkerScalingSettingsConflictError);
    expect(err.statusCode).toBe(409);
    expect(audit.create).not.toHaveBeenCalled();
    expect(provider.refresh).not.toHaveBeenCalled();
  });
});

describe('workerScalingEnforcedCheck', () => {
  const log = () => ({ warn: vi.fn() });

  it('adoção ligada no processo: em vigor sem consultar batimentos', async () => {
    const heartbeats = { hasAlive: vi.fn(async () => false) };
    expect(await workerScalingEnforcedCheck(() => true, heartbeats, log())()).toBe(true);
    expect(heartbeats.hasAlive).not.toHaveBeenCalled();
  });

  it('flag só no worker (processo http): batimento vivo = em vigor; sem batimento = sem efeito', async () => {
    const heartbeats = { hasAlive: vi.fn(async () => true) };
    const check = workerScalingEnforcedCheck(() => false, heartbeats, log());
    expect(await check()).toBe(true);
    expect(heartbeats.hasAlive).toHaveBeenCalledWith(WORKER_ALIVE_MS);
    heartbeats.hasAlive.mockResolvedValueOnce(false);
    expect(await check()).toBe(false);
  });

  it('falha na consulta de batimento: cai na flag local com warn, sem lançar', async () => {
    const l = log();
    const heartbeats = { hasAlive: vi.fn(async () => { throw new TypeError('db'); }) };
    expect(await workerScalingEnforcedCheck(() => false, heartbeats, l)()).toBe(false);
    expect(l.warn).toHaveBeenCalledWith({ err: 'TypeError' }, expect.any(String));
  });

  it('use case aguarda o check assíncrono', async () => {
    const check = workerScalingEnforcedCheck(() => false, { hasAlive: async () => true }, log());
    const view = await new GetWorkerScalingSettingsUseCase(makeRepo(null), { envDefaults, isEnforced: check }).execute();
    expect(view.enforced).toBe(true);
  });

  it('PUT não vira 500 se a consulta de batimento falhar depois de gravar', async () => {
    const isEnforced = workerScalingEnforcedCheck(() => false, { hasAlive: async () => { throw new Error('db'); } }, log());
    const repo = makeRepo(null);
    const uc = new UpdateWorkerScalingSettingsUseCase(repo, makeAuditRepo(), makeProvider(), { envDefaults, isEnforced });
    const view = await uc.execute({ settings: full(), expectedUpdatedAt: null, actorUserId: 'u1' });
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(view.enforced).toBe(false);
  });
});
