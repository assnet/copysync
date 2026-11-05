import { describe, expect, it } from 'vitest';
import { env, parseEnv, processRoleIssues } from './env';
import { currentRole, runsHttp, runsSessions, usesRedis } from './processRole';

const base = { ...process.env, PROCESS_ROLE: undefined, REDIS_URL: undefined, MEDIA_STORAGE_DRIVER: undefined };
const REDIS = 'redis://localhost:6379';

function issues(over: NodeJS.ProcessEnv): string[] {
  const r = parseEnv({ ...base, ...over });
  return r.success ? [] : r.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
}

describe('PROCESS_ROLE', () => {
  it('sem env: all, sem Redis', () => {
    const r = parseEnv(base);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.PROCESS_ROLE).toBe('all');
    expect(r.data.REDIS_URL).toBeUndefined();
    expect(usesRedis(r.data.PROCESS_ROLE)).toBe(false);
    expect(currentRole()).toBe(env.PROCESS_ROLE);
  });

  it('all + REDIS_URL continua sem Redis e com driver local', () => {
    const r = parseEnv({ ...base, REDIS_URL: REDIS });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.PROCESS_ROLE).toBe('all');
    expect(usesRedis(r.data.PROCESS_ROLE)).toBe(false);
  });

  it('REDIS_URL vazio vale como ausente', () => {
    const r = parseEnv({ ...base, REDIS_URL: '  ' });
    expect(r.success && r.data.REDIS_URL).toBeUndefined();
  });

  it('worker sem REDIS_URL falha com mensagem', () => {
    const list = issues({ PROCESS_ROLE: 'worker', MEDIA_STORAGE_DRIVER: 's3' });
    expect(list).toEqual(['REDIS_URL: PROCESS_ROLE=worker requires REDIS_URL']);
  });

  it('http com driver local falha com mensagem', () => {
    const list = issues({ PROCESS_ROLE: 'http', REDIS_URL: REDIS, MEDIA_STORAGE_DRIVER: 'local' });
    expect(list).toEqual(['MEDIA_STORAGE_DRIVER: PROCESS_ROLE=http requires MEDIA_STORAGE_DRIVER=s3 (got local)']);
  });

  it('http/worker com Redis e s3 passam', () => {
    for (const role of ['http', 'worker']) {
      expect(issues({ PROCESS_ROLE: role, REDIS_URL: REDIS, MEDIA_STORAGE_DRIVER: 's3' })).toEqual([]);
    }
  });

  it('papel inválido falha', () => {
    expect(issues({ PROCESS_ROLE: 'both' }).length).toBe(1);
  });

  it('processRoleIssues: all nunca falha', () => {
    expect(processRoleIssues({ PROCESS_ROLE: 'all', REDIS_URL: undefined, MEDIA_STORAGE_DRIVER: 'local' })).toEqual([]);
  });
});

describe('funções de papel', () => {
  it.each([
    ['all', true, true, false],
    ['http', false, true, true],
    ['worker', true, false, true],
  ] as const)('%s → sessões %s, http %s, redis %s', (role, sessions, http, redis) => {
    expect(runsSessions(role)).toBe(sessions);
    expect(runsHttp(role)).toBe(http);
    expect(usesRedis(role)).toBe(redis);
  });
});

describe('ENGINE_COMMAND_CONCURRENCY', () => {
  const b = { ...base, ENGINE_COMMAND_CONCURRENCY: undefined };
  it('default 2', () => {
    const r = parseEnv(b);
    expect(r.success && r.data.ENGINE_COMMAND_CONCURRENCY).toBe(2);
  });
  it('aceita inteiro positivo e recusa 0/fração', () => {
    const r = parseEnv({ ...b, ENGINE_COMMAND_CONCURRENCY: '5' });
    expect(r.success && r.data.ENGINE_COMMAND_CONCURRENCY).toBe(5);
    expect(parseEnv({ ...b, ENGINE_COMMAND_CONCURRENCY: '0' }).success).toBe(false);
    expect(parseEnv({ ...b, ENGINE_COMMAND_CONCURRENCY: '1.5' }).success).toBe(false);
  });
});
