import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IWorkerScalingSettingsRepository,
  WorkerScalingSettingsRecord,
} from '../../domain/contracts/IWorkerScalingSettingsRepository';
import { RefreshingWorkerScalingSettingsProvider } from './RefreshingWorkerScalingSettingsProvider';

const envDefaults = { maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 5 };
const record = (value: unknown, by: string | null = 'admin-1'): WorkerScalingSettingsRecord => ({
  value,
  updatedAt: new Date('2026-11-11T00:00:00Z'),
  updatedById: by,
});

function setup(refreshMs?: number) {
  const repository = { get: vi.fn(), save: vi.fn() } as unknown as IWorkerScalingSettingsRepository & {
    get: ReturnType<typeof vi.fn>;
  };
  const log = { warn: vi.fn() };
  const provider = new RefreshingWorkerScalingSettingsProvider({ repository, envDefaults, logger: log, refreshMs });
  return { repository, log, provider };
}

describe('RefreshingWorkerScalingSettingsProvider', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('nasce com o default da env, sem I/O', () => {
    const { repository, provider } = setup();
    const { value, origin } = provider.current();
    expect(value.maxSessionsPerWorker).toBe(40);
    expect(value.maxPendingLoginsPerWorker).toBe(5);
    expect(value.scalerMode).toBe('off');
    expect(origin.maxSessionsPerWorker).toBe('default');
    expect(repository.get).not.toHaveBeenCalled();
    expect(provider.lastUpdate()).toBeNull();
  });

  it('troca o valor após refresh e guarda autor/data', async () => {
    const { repository, provider } = setup();
    repository.get.mockResolvedValueOnce(record({ maxSessionsPerWorker: 80 }));
    await provider.refresh();
    expect(provider.current().value.maxSessionsPerWorker).toBe(80);
    expect(provider.current().origin.maxSessionsPerWorker).toBe('saved');
    expect(provider.current().value.maxPendingLoginsPerWorker).toBe(5);
    expect(provider.lastUpdate()).toEqual({ updatedAt: new Date('2026-11-11T00:00:00Z'), updatedById: 'admin-1' });
  });

  it('sem linha volta ao default', async () => {
    const { repository, provider } = setup();
    repository.get.mockResolvedValueOnce(record({ maxSessionsPerWorker: 80 })).mockResolvedValueOnce(null);
    await provider.refresh();
    await provider.refresh();
    expect(provider.current().value.maxSessionsPerWorker).toBe(40);
    expect(provider.lastUpdate()).toBeNull();
  });

  it('falha preserva o anterior e loga warn uma vez por sequência', async () => {
    const { repository, log, provider } = setup();
    repository.get
      .mockResolvedValueOnce(record({ maxSessionsPerWorker: 80 }))
      .mockRejectedValueOnce(new Error('db down'))
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(record({ maxSessionsPerWorker: 90 }))
      .mockRejectedValueOnce(new Error('db down'));
    await provider.refresh();
    await expect(provider.refresh()).resolves.toBeUndefined();
    await provider.refresh();
    expect(provider.current().value.maxSessionsPerWorker).toBe(80);
    expect(log.warn).toHaveBeenCalledTimes(1);
    await provider.refresh();
    expect(provider.current().value.maxSessionsPerWorker).toBe(90);
    await provider.refresh();
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(provider.current().value.maxSessionsPerWorker).toBe(90);
  });

  it('JSON inválido mantém o anterior e não loga o conteúdo', async () => {
    const { repository, log, provider } = setup();
    repository.get
      .mockResolvedValueOnce(record({ maxSessionsPerWorker: 80 }))
      .mockResolvedValueOnce(record({ maxSessionsPerWorker: 'segredo-123' }))
      .mockResolvedValueOnce(record({ campoEstranho: 1 }));
    await provider.refresh();
    await provider.refresh();
    await provider.refresh();
    expect(provider.current().value.maxSessionsPerWorker).toBe(80);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('segredo-123');
  });

  it('start agenda refresh periódico; duas vezes não duplica; stop cancela', async () => {
    const { repository, provider } = setup(1000);
    repository.get.mockResolvedValue(null);
    provider.start();
    provider.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(repository.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(repository.get).toHaveBeenCalledTimes(2);
    provider.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(repository.get).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('intervalo padrão de 30 s', async () => {
    const { repository, provider } = setup();
    repository.get.mockResolvedValue(null);
    provider.start();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(repository.get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(repository.get).toHaveBeenCalledTimes(1);
    provider.stop();
  });
});
