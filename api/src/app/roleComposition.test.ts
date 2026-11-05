import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const loaded = new Set<string>();
  const localEngineObj = { kind: 'local', listLocalSessionIds: () => [] as string[] };
  const env = {
    REDIS_URL: 'redis://r:6379',
    S3_ENABLED: true,
    S3_ENDPOINT: 'http://s3',
    S3_BUCKET: 'b',
    S3_REGION: 'auto',
    S3_ACCESS_KEY_ID: 'k',
    S3_SECRET_ACCESS_KEY: 's',
    S3_PUBLIC_URL: undefined as string | undefined,
    TELEGRAM_ENGINE_ENABLED: false,
    TELEGRAM_API_ID: undefined as number | undefined,
    TELEGRAM_API_HASH: undefined as string | undefined,
    ENGINE_COMMAND_CONCURRENCY: 3,
  };
  const clients = { command: { name: 'command' }, subscriber: { name: 'subscriber' }, bull: { name: 'bull' } };
  return {
    loaded,
    env,
    clients,
    localEngineObj,
    localEngine: vi.fn(() => localEngineObj),
    bindRedisAccess: vi.fn(),
    setActiveEngine: vi.fn(),
    setRelay: vi.fn(),
    deliverLocal: vi.fn(),
    release: { execute: vi.fn() },
    repo: { findLiveOwner: vi.fn() },
    rpcServer: { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) },
    rpcClient: { close: vi.fn(async () => undefined) },
    queues: { startConsumers: vi.fn(), close: vi.fn(async () => undefined) },
    relay: { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined), publish: vi.fn() },
    ctor: {
      rpcServer: vi.fn(), rpcClient: vi.fn(), queues: vi.fn(), relay: vi.fn(),
      commandServer: vi.fn(), remote: vi.fn(), transfer: vi.fn(), s3: vi.fn(),
    },
  };
});

const track = <T>(name: string, mod: T): T => {
  h.loaded.add(name);
  return mod;
};

vi.mock('../shared/config/env', () => ({ env: h.env }));
vi.mock('../shared/logger/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../modules/messaging/infrastructure/localEngineContainer', () =>
  track('localEngine', { localEngine: h.localEngine }));
vi.mock('../shared/redis/redisConnections', () => track('redis', {
  bindRedisAccess: h.bindRedisAccess,
  redisCommand: () => h.clients.command,
  redisSubscriber: () => h.clients.subscriber,
  bullConnection: () => h.clients.bull,
}));
vi.mock('../modules/sessions/infrastructure/lease/sessionLeaseContainer', () => track('lease', {
  sessionLeaseContainer: () => ({ workerId: 'w-1', release: h.release, repo: h.repo }),
}));
vi.mock('../modules/messaging/infrastructure/remote/EngineCommandServer', () => track('remote', {
  EngineCommandServer: class { constructor(...a: unknown[]) { h.ctor.commandServer(...a); } },
}));
vi.mock('../modules/messaging/infrastructure/remote/transport/RedisEngineRpc', () => track('remote', {
  RedisEngineRpcServer: class {
    start = h.rpcServer.start; stop = h.rpcServer.stop;
    constructor(o: unknown) { h.ctor.rpcServer(o); }
  },
  RedisEngineRpcClient: class {
    close = h.rpcClient.close;
    constructor(o: unknown) { h.ctor.rpcClient(o); }
  },
}));
vi.mock('../modules/messaging/infrastructure/remote/transport/BullEngineCommandQueues', () => track('remote', {
  BullEngineCommandQueues: class {
    startConsumers = h.queues.startConsumers; close = h.queues.close;
    constructor(o: unknown) { h.ctor.queues(o); }
  },
}));
vi.mock('../modules/messaging/infrastructure/remote/RemoteMessagingEngineAdapter', () => track('remote', {
  RemoteMessagingEngineAdapter: class {
    kind = 'remote';
    constructor(o: unknown) { h.ctor.remote(o); }
  },
  enabledEnginesFromEnv: () => new Set(['baileys']),
}));
vi.mock('../modules/messaging/infrastructure/remote/outboundMediaTransfer', () => track('remote', {
  OutboundMediaTransfer: class { kind = 'transfer'; constructor(s: unknown) { h.ctor.transfer(s); } },
  S3OutboundObjectStore: class { constructor(c: unknown) { h.ctor.s3(c); } },
}));
vi.mock('../modules/chat/infrastructure/ws/ChatWebSocketPublisher', () => track('ws', {
  chatWsPublisher: { setRelay: h.setRelay, deliverLocal: h.deliverLocal },
}));
vi.mock('../modules/chat/infrastructure/ws/RedisChatEventRelay', () => track('remote', {
  RedisChatEventRelay: class {
    start = h.relay.start; stop = h.relay.stop; publish = h.relay.publish;
    constructor(o: unknown) { h.ctor.relay(o); }
  },
}));
vi.mock('../shared/engine/activeEngine', () => ({ setActiveEngine: h.setActiveEngine }));
vi.mock('../shared/security/SecretCipherFactory', () => ({ SecretCipherFactory: { check: () => null } }));
vi.mock('../shared/config/workerIdentity', () => ({ currentWorkerId: () => 'http-1' }));

import { composeForRole } from './roleComposition';

beforeEach(() => {
  vi.clearAllMocks();
  h.loaded.clear();
  h.env.S3_ENABLED = true;
});

describe('composeForRole', () => {
  it('all: só localEngine(), sem tocar redisConnections nem módulos remotos', async () => {
    const c = await composeForRole('all');
    expect(c.engine).toBe(h.localEngineObj);
    expect(h.localEngine).toHaveBeenCalledTimes(1);
    expect([...h.loaded]).toEqual(['localEngine']);
    expect(h.bindRedisAccess).not.toHaveBeenCalled();
    expect(h.setRelay).not.toHaveBeenCalled();
    await expect(c.stop()).resolves.toBeUndefined();
  });

  it('http: engine remota ativa, relay deliver, nunca chama localEngine()', async () => {
    const c = await composeForRole('http');
    expect(h.localEngine).not.toHaveBeenCalled();
    expect(h.loaded.has('localEngine')).toBe(false);
    expect(c.engine).toMatchObject({ kind: 'remote' });
    expect(h.setActiveEngine).toHaveBeenCalledWith(c.engine);
    expect(h.bindRedisAccess).toHaveBeenCalledTimes(1);
    expect(h.bindRedisAccess.mock.calls[0][0].enabled()).toBe(true);
    expect(h.bindRedisAccess.mock.calls[0][0].url()).toBe('redis://r:6379');

    const deps = h.ctor.remote.mock.calls[0][0];
    expect(deps.owners).toBe(h.repo);
    expect(deps.mediaTransfer).toMatchObject({ kind: 'transfer' });
    expect(h.ctor.rpcClient).toHaveBeenCalledWith(expect.objectContaining({
      publisher: h.clients.command, subscriber: h.clients.subscriber,
    }));
    expect(h.ctor.queues).toHaveBeenCalledWith({ connection: h.clients.bull });
    expect(h.queues.startConsumers).not.toHaveBeenCalled();

    const relayOpts = h.ctor.relay.mock.calls[0][0];
    expect(relayOpts).toMatchObject({ mode: 'deliver', client: h.clients.subscriber });
    relayOpts.deliver('t-1', { event: 'ping' });
    expect(h.deliverLocal).toHaveBeenCalledWith('t-1', { event: 'ping' });
    expect(h.relay.start).toHaveBeenCalledTimes(1);
    expect(h.setRelay).not.toHaveBeenCalled();

    await c.stop();
    await c.stop();
    expect(h.relay.stop).toHaveBeenCalledTimes(1);
    expect(h.rpcClient.close).toHaveBeenCalledTimes(1);
    expect(h.queues.close).toHaveBeenCalledTimes(1);
  });

  it('worker: engine local + servidor de comandos no RPC e nas filas + relay publish', async () => {
    const c = await composeForRole('worker');
    expect(c.engine).toBe(h.localEngineObj);
    expect(h.setActiveEngine).not.toHaveBeenCalled();
    expect(h.ctor.commandServer).toHaveBeenCalledWith(
      h.localEngineObj, h.localEngineObj, h.release, expect.objectContaining({ kind: 'transfer' }),
    );
    expect(h.ctor.rpcServer).toHaveBeenCalledWith(expect.objectContaining({
      workerId: 'w-1', subscriber: h.clients.subscriber, publisher: h.clients.command,
    }));
    expect(h.rpcServer.start).toHaveBeenCalledTimes(1);
    expect(h.ctor.queues).toHaveBeenCalledWith({ connection: h.clients.bull, concurrency: 3 });
    expect(h.queues.startConsumers).toHaveBeenCalledWith('w-1', expect.anything());
    expect(h.ctor.relay).toHaveBeenCalledWith({ mode: 'publish', client: h.clients.command });
    expect(h.setRelay).toHaveBeenCalledTimes(1);

    await c.stop();
    expect(h.rpcServer.stop).toHaveBeenCalledTimes(1);
    expect(h.queues.close).toHaveBeenCalledTimes(1);
    expect(h.setRelay).toHaveBeenCalledTimes(1);
  });

  it('stop continua mesmo se um componente falhar', async () => {
    h.rpcServer.stop.mockRejectedValueOnce(new Error('x'));
    const c = await composeForRole('worker');
    await expect(c.stop()).resolves.toBeUndefined();
    expect(h.queues.close).toHaveBeenCalledTimes(1);
  });

  it('worker: falha ao assinar o RPC não deixa consumidores ligados', async () => {
    h.rpcServer.start.mockRejectedValueOnce(new Error('redis fora'));
    await expect(composeForRole('worker')).rejects.toThrow('redis fora');
    expect(h.queues.startConsumers).not.toHaveBeenCalled();
    expect(h.setRelay).not.toHaveBeenCalled();
  });

  it('http/worker sem S3 configurado falham no boot', async () => {
    h.env.S3_ENABLED = false;
    await expect(composeForRole('http')).rejects.toThrow(/S3/);
    await expect(composeForRole('worker')).rejects.toThrow(/S3/);
  });
});
