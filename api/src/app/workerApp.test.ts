import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildWorkerApp, type WorkerHealthProbe } from './workerApp';

function probe(overrides: Partial<WorkerHealthProbe> = {}): WorkerHealthProbe {
  return {
    workerId: 'w-1',
    localSessions: () => 3,
    redis: async () => true,
    database: async () => true,
    ...overrides,
  };
}

describe('buildWorkerApp', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('200 com papel, workerId e sessões locais quando Redis e banco respondem', async () => {
    app = buildWorkerApp(probe());
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      role: 'worker',
      workerId: 'w-1',
      localSessions: 3,
      redis: 'ok',
      database: 'ok',
    });
  });

  it('503 quando o Redis cai', async () => {
    app = buildWorkerApp(probe({ redis: async () => false }));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'error', redis: 'down', database: 'ok' });
  });

  it('503 quando o banco lança', async () => {
    app = buildWorkerApp(
      probe({
        database: async () => {
          throw new Error('conexão recusada');
        },
      }),
    );
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'error', redis: 'ok', database: 'down' });
  });

  it('verificação que não responde no prazo conta como down', async () => {
    app = buildWorkerApp(probe({ redis: () => new Promise<boolean>(() => {}) }), { checkTimeoutMs: 20 });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ redis: 'down' });
  });

  it('só expõe /health', async () => {
    app = buildWorkerApp(probe());
    const res = await app.inject({ method: 'GET', url: '/api/v1/sessions' });
    expect(res.statusCode).toBe(404);
  });
});
