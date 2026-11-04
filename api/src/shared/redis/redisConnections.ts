import { Redis, type RedisOptions } from 'ioredis';

/**
 * Clientes Redis do processo, criados só na 1ª chamada (importar este módulo não conecta).
 * Só `http`/`worker` usam Redis; em `all` (padrão) todo getter lança, mesmo com `REDIS_URL`.
 *
 * O acesso (papel + URL) é ligado no boot por `bindRedisAccess` — até lá, tudo desligado.
 * Assim o módulo não lê `env` no import nem depende da ordem de composição.
 */
export interface RedisAccess {
  /** `usesRedis(currentRole())` no boot. */
  enabled: () => boolean;
  /** `env.REDIS_URL`. */
  url: () => string | undefined;
  /** Erro de conexão (ioredis emite `error` e reconecta sozinho). */
  onError?: (client: RedisClientName, err: Error) => void;
}

export type RedisClientName = 'command' | 'subscriber' | 'bull';

const DISABLED: RedisAccess = { enabled: () => false, url: () => undefined };

let access: RedisAccess = DISABLED;
const clients = new Map<RedisClientName, Redis>();

export function bindRedisAccess(next: RedisAccess): void {
  access = next;
}

function open(name: RedisClientName, options: RedisOptions = {}): Redis {
  const existing = clients.get(name);
  if (existing) return existing;
  if (!access.enabled()) {
    throw new Error('Redis indisponível neste papel de processo (PROCESS_ROLE=all não usa Redis)');
  }
  const url = access.url();
  if (!url) throw new Error('REDIS_URL ausente para papel que usa Redis');
  const client = new Redis(url, { connectionName: name, ...options });
  client.on('error', (err: Error) => access.onError?.(name, err));
  clients.set(name, client);
  return client;
}

/** Comandos comuns (GET/SET/PUBLISH/RPC). */
export function redisCommand(): Redis {
  return open('command');
}

/** Cliente em modo assinante (SUBSCRIBE/PSUBSCRIBE); não aceita outros comandos. */
export function redisSubscriber(): Redis {
  return open('subscriber');
}

/** Conexão compartilhada de filas/workers BullMQ (exige `maxRetriesPerRequest: null`). */
export function bullConnection(): Redis {
  return open('bull', { maxRetriesPerRequest: null });
}

/** Fecha todos os clientes abertos. Idempotente; sem conexão é no-op. */
export async function closeAllRedis(): Promise<void> {
  const opened = [...clients.values()];
  clients.clear();
  await Promise.all(
    opened.map(async (client) => {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }),
  );
}
