import { beforeEach, describe, expect, it, vi } from 'vitest';

const ctor = vi.fn();
const quit = vi.fn(async () => 'OK');
const disconnect = vi.fn();

vi.mock('ioredis', () => {
  class Redis {
    handlers: Record<string, (e: Error) => void> = {};
    constructor(url: string, opts: unknown) {
      ctor(url, opts);
    }
    on(ev: string, fn: (e: Error) => void) {
      this.handlers[ev] = fn;
      return this;
    }
    quit = quit;
    disconnect = disconnect;
  }
  return { Redis, default: Redis };
});

type Mod = typeof import('./redisConnections');
let mod: Mod;
const URL = 'redis://127.0.0.1:6390';

beforeEach(async () => {
  vi.resetModules();
  ctor.mockClear();
  quit.mockClear();
  disconnect.mockClear();
  mod = await import('./redisConnections');
});

describe('redisConnections', () => {
  it('importar o módulo não abre conexão', () => {
    expect(ctor).not.toHaveBeenCalled();
  });

  it('em all (acesso não ligado) todo getter lança', () => {
    expect(() => mod.redisCommand()).toThrow(/PROCESS_ROLE=all/);
    expect(() => mod.redisSubscriber()).toThrow();
    expect(() => mod.bullConnection()).toThrow();
    expect(ctor).not.toHaveBeenCalled();
  });

  it('acesso desligado lança mesmo com URL', () => {
    mod.bindRedisAccess({ enabled: () => false, url: () => URL });
    expect(() => mod.redisCommand()).toThrow();
    expect(ctor).not.toHaveBeenCalled();
  });

  it('ligado sem URL lança', () => {
    mod.bindRedisAccess({ enabled: () => true, url: () => undefined });
    expect(() => mod.redisCommand()).toThrow(/REDIS_URL/);
  });

  it('closeAllRedis sem conexão é no-op e idempotente', async () => {
    await mod.closeAllRedis();
    await mod.closeAllRedis();
    expect(quit).not.toHaveBeenCalled();
  });

  it('cria cada cliente uma vez, na 1ª chamada; BullMQ com maxRetriesPerRequest null', () => {
    mod.bindRedisAccess({ enabled: () => true, url: () => URL });
    const a = mod.redisCommand();
    expect(mod.redisCommand()).toBe(a);
    expect(mod.redisSubscriber()).not.toBe(a);
    mod.bullConnection();
    mod.bullConnection();
    expect(ctor).toHaveBeenCalledTimes(3);
    expect(ctor).toHaveBeenLastCalledWith(URL, expect.objectContaining({ maxRetriesPerRequest: null }));
    expect(ctor.mock.calls[0][1]).not.toHaveProperty('maxRetriesPerRequest');
  });

  it('repassa erro de conexão ao onError', () => {
    const onError = vi.fn();
    mod.bindRedisAccess({ enabled: () => true, url: () => URL, onError });
    const c = mod.redisCommand() as unknown as { handlers: Record<string, (e: Error) => void> };
    const err = new Error('ECONNREFUSED');
    c.handlers.error(err);
    expect(onError).toHaveBeenCalledWith('command', err);
  });

  it('closeAllRedis fecha os abertos uma vez; falha no quit cai para disconnect; reabre depois', async () => {
    mod.bindRedisAccess({ enabled: () => true, url: () => URL });
    mod.redisCommand();
    mod.bullConnection();
    quit.mockRejectedValueOnce(new Error('closed'));
    await mod.closeAllRedis();
    await mod.closeAllRedis();
    expect(quit).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalledTimes(1);
    mod.redisCommand();
    expect(ctor).toHaveBeenCalledTimes(3);
  });
});
