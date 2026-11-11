import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';
import { workerAdoptionConfig, workerScalingEnvDefaults } from './workerAdoption';

const base = {
  ...process.env,
  WORKER_ADOPTION_ENABLED: undefined,
  WORKER_MAX_SESSIONS: undefined,
  WORKER_MAX_PENDING_LOGINS: undefined,
  WORKER_SHARD: undefined,
};

function config(over: NodeJS.ProcessEnv) {
  const r = parseEnv({ ...base, ...over });
  if (!r.success) throw new Error(r.error.message);
  return { ...workerAdoptionConfig(r.data), ...workerScalingEnvDefaults(r.data) };
}

describe('workerAdoptionConfig', () => {
  it('sem env: desligada, teto 40, 50 logins pendentes, sem shard', () => {
    expect(config({})).toEqual({ enabled: false, maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 50, shard: null });
  });

  it('lê os valores definidos', () => {
    expect(config({ WORKER_ADOPTION_ENABLED: 'true', WORKER_MAX_SESSIONS: '12', WORKER_MAX_PENDING_LOGINS: '7', WORKER_SHARD: ' sa-1 ' })).toEqual({
      enabled: true,
      maxSessionsPerWorker: 12,
      maxPendingLoginsPerWorker: 7,
      shard: 'sa-1',
    });
  });

  it('flag diferente de "true" fica desligada', () => {
    expect(config({ WORKER_ADOPTION_ENABLED: '1' }).enabled).toBe(false);
  });

  it('WORKER_SHARD vazio ou só espaços → null', () => {
    expect(config({ WORKER_SHARD: '' }).shard).toBeNull();
    expect(config({ WORKER_SHARD: '   ' }).shard).toBeNull();
  });

  it.each(['0', '-3', '2.5', 'abc'])('teto inválido %s falha o parse', (v) => {
    const r = parseEnv({ ...base, WORKER_MAX_SESSIONS: v });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.errors.map((e) => e.path.join('.'))).toEqual(['WORKER_MAX_SESSIONS']);
  });

  it.each(['0', '-1', '1.5', 'x'])('teto de logins pendentes inválido %s falha o parse', (v) => {
    const r = parseEnv({ ...base, WORKER_MAX_PENDING_LOGINS: v });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.errors.map((e) => e.path.join('.'))).toEqual(['WORKER_MAX_PENDING_LOGINS']);
  });

  it('sem argumento lê o env do processo', () => {
    expect(workerAdoptionConfig()).toEqual(expect.objectContaining({ enabled: expect.any(Boolean) }));
    expect(workerScalingEnvDefaults()).toEqual({ maxSessionsPerWorker: expect.any(Number), maxPendingLoginsPerWorker: expect.any(Number) });
  });
});
