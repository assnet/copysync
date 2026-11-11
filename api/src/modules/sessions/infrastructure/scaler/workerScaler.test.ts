import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkerScaler, missingScalerConfig, resetWorkerScalerWarningsForTests } from './workerScaler';
import { logger } from '../../../../shared/logger/logger';
import { NotConfiguredWorkerScaler } from './NotConfiguredWorkerScaler';
import { RenderWorkerScaler } from './RenderWorkerScaler';
import { env, parseEnv } from '../../../../shared/config/env';

describe('createWorkerScaler', () => {
  beforeEach(() => resetWorkerScalerWarningsForTests());

  it('sem nada: not_configured com os três nomes, nenhuma chamada', async () => {
    const fetchFn = vi.fn();
    const s = createWorkerScaler({ enabled: false }, { fetchFn: fetchFn as unknown as typeof fetch });
    expect(s).toBeInstanceOf(NotConfiguredWorkerScaler);
    await expect(s.getState()).resolves.toEqual({
      status: 'not_configured',
      missing: ['WORKER_SCALER_ENABLED', 'RENDER_API_KEY', 'WORKER_SCALER_SERVICE_ID'],
    });
    await expect(s.scaleTo(2)).rejects.toMatchObject({ code: 'SCALER_NOT_CONFIGURED', statusCode: 409 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('flag desligada com chave e id ainda é not_configured, sem vazar valores', async () => {
    const s = createWorkerScaler({ enabled: false, apiKey: 'rnd_secret', serviceId: 'srv-x1' });
    const state = await s.getState();
    expect(state).toEqual({ status: 'not_configured', missing: ['WORKER_SCALER_ENABLED'] });
    expect(JSON.stringify(state)).not.toMatch(/rnd_secret|srv-x1/);
  });

  it('ligada sem id lista só o id', () => {
    expect(missingScalerConfig({ enabled: true, apiKey: 'k' })).toEqual(['WORKER_SCALER_SERVICE_ID']);
  });

  it('id fora do formato conta como ausente e avisa uma vez, sem o valor', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const fetchFn = vi.fn();
    const cfg = { enabled: true, apiKey: 'k', serviceId: 'dpg-typo99' };
    const s = createWorkerScaler(cfg, { fetchFn: fetchFn as unknown as typeof fetch });
    createWorkerScaler(cfg);
    expect(s).toBeInstanceOf(NotConfiguredWorkerScaler);
    await expect(s.getState()).resolves.toEqual({ status: 'not_configured', missing: ['WORKER_SCALER_SERVICE_ID'] });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('dpg-typo99');
    warn.mockRestore();
  });

  it('as três presentes: adaptador Render', () => {
    expect(createWorkerScaler({ enabled: true, apiKey: 'k', serviceId: 'srv-x1' })).toBeInstanceOf(RenderWorkerScaler);
  });
});

describe('envs do escalador', () => {
  it('padrão desligado e sem id', () => {
    expect(env.WORKER_SCALER_ENABLED).toBe(false);
  });

  it('id fora do formato não derruba o boot (validado no escalador)', () => {
    const ok = parseEnv({ ...process.env, WORKER_SCALER_SERVICE_ID: ' srv-abc123 ' });
    expect(ok.success && ok.data.WORKER_SCALER_SERVICE_ID).toBe('srv-abc123');
    const typo = parseEnv({ ...process.env, WORKER_SCALER_SERVICE_ID: 'dpg-abc' });
    expect(typo.success && typo.data.WORKER_SCALER_SERVICE_ID).toBe('dpg-abc');
    const empty = parseEnv({ ...process.env, WORKER_SCALER_SERVICE_ID: '' });
    expect(empty.success && empty.data.WORKER_SCALER_SERVICE_ID).toBeUndefined();
  });
});
