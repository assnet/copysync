import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

/** Dependências do `/health` do worker; o boot (T19) liga às conexões reais. */
export interface WorkerHealthProbe {
  workerId: string;
  /** Sessões com socket aberto neste processo. */
  localSessions: () => number;
  /** `true` se o Redis respondeu (ex.: PING). */
  redis: () => Promise<boolean>;
  /** `true` se o banco respondeu (ex.: SELECT 1). */
  database: () => Promise<boolean>;
}

export interface WorkerAppOptions {
  logger?: FastifyServerOptions['logger'];
  /** Teto de cada verificação; passou disso conta como `down`. */
  checkTimeoutMs?: number;
}

type CheckState = 'ok' | 'down';

async function check(fn: () => Promise<boolean>, timeoutMs: number): Promise<CheckState> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return (await Promise.race([fn(), timeout])) ? 'ok' : 'down';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fastify mínimo do papel `worker` (Private Service na Render, decisão D10):
 * só `GET /health`, sem auth, helmet, cors nem rotas da API.
 */
export function buildWorkerApp(probe: WorkerHealthProbe, options: WorkerAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const timeoutMs = options.checkTimeoutMs ?? 3000;

  app.get('/health', async (_request, reply) => {
    const [redis, database] = await Promise.all([
      check(probe.redis, timeoutMs),
      check(probe.database, timeoutMs),
    ]);
    const healthy = redis === 'ok' && database === 'ok';
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'error',
      role: 'worker',
      workerId: probe.workerId,
      localSessions: probe.localSessions(),
      redis,
      database,
    });
  });

  return app;
}
