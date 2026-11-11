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
    adoption: { enabled: false, shard: null as string | null },
    maxSessions: 2,
    local: [] as string[],
    pending: 0,
    repo: { findLiveOwner: vi.fn() },
    rpcServer: { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) },
    rpcClient: { close: vi.fn(async () => undefined) },
    queues: { startConsumers: vi.fn(), close: vi.fn(async () => undefined) },
    relay: { start: vi.fn(async (): Promise<void> => undefined), stop: vi.fn(async () => undefined), publish: vi.fn() },
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
  sessionLeaseContainer: () => ({ workerId: 'w-1', release: h.release, repo: h.repo, listLocal: () => h.local, occupancy: () => ({ sessions: h.local.length, pendingLogins: h.pending }) }),
  workerScalingSettingsProvider: () => ({ current: () => ({ value: { maxSessionsPerWorker: h.maxSessions } }) }),
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
vi.mock('../shared/config/workerAdoption', () => ({ workerAdoptionConfig: () => h.adoption }));
vi.mock('../shared/config/workerIdentity', () => ({ currentWorkerId: () => 'http-1' }));

import { composeForRole, relayHealth, RELAY_RETRY_BASE_MS } from './roleComposition';

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  h.relay.start.mockImplementation(async () => undefined);
  h.loaded.clear();
  h.env.S3_ENABLED = true;
  h.adoption.enabled = false;
  h.local = [];
  h.pending = 0;
  h.maxSessions = 2;
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
    expect(c.outboundMedia).toMatchObject({ kind: 'transfer' }); // mesma instância do servidor de comandos
    expect(c.outboundMedia).toBe(h.ctor.commandServer.mock.calls[0][3]);

    await c.stop();
    expect(h.rpcServer.stop).toHaveBeenCalledTimes(1);
    expect(h.queues.close).toHaveBeenCalledTimes(1);
    expect(h.setRelay).toHaveBeenCalledTimes(1);
  });

  it('worker com adoção ligada: session-open recebe a vaga do processo (ADOPT-09)', async () => {
    h.adoption.enabled = true;
    await composeForRole('worker');
    const opts = h.ctor.queues.mock.calls[0][0];
    expect(opts).toMatchObject({ connection: h.clients.bull, concurrency: 3 });
    expect(opts.sessionOpenHasCapacity()).toBe(true);
    h.local = ['s1'];
    expect(opts.sessionOpenHasCapacity()).toBe(true);
    h.pending = 9; // logins pendentes (QR sem leitura) não ocupam vaga (T24)
    expect(opts.sessionOpenHasCapacity()).toBe(true);
    h.local = ['s1', 's2'];
    expect(opts.sessionOpenHasCapacity()).toBe(false);
  });

  it('worker com adoção ligada: session-open lê o teto da configuração a cada checagem (WSCALE-04)', async () => {
    h.adoption.enabled = true;
    h.local = ['s1', 's2'];
    await composeForRole('worker');
    const opts = h.ctor.queues.mock.calls[0][0];
    expect(opts.sessionOpenHasCapacity()).toBe(false);
    h.maxSessions = 3;
    expect(opts.sessionOpenHasCapacity()).toBe(true);
    h.maxSessions = 1;
    h.local = ['s1'];
    expect(opts.sessionOpenHasCapacity()).toBe(false);
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

  it('http: composição não espera o relay; /health mostra down → up', async () => {
    let resolveStart!: () => void;
    h.relay.start.mockImplementationOnce(() => new Promise<void>((r) => { resolveStart = r; }));
    const c = await composeForRole('http');
    expect(h.relay.start).toHaveBeenCalledTimes(1);
    expect(relayHealth()).toBe('down');
    resolveStart();
    await vi.waitFor(() => expect(relayHealth()).toBe('up'));
    await c.stop();
    expect(relayHealth()).toBe('down');
  });

  it('http: relay que falha tenta de novo com backoff até subir', async () => {
    vi.useFakeTimers();
    h.relay.start
      .mockRejectedValueOnce(new Error('redis fora'))
      .mockRejectedValueOnce(new Error('redis fora'));
    const c = await composeForRole('http');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.relay.start).toHaveBeenCalledTimes(1);
    expect(h.relay.stop).toHaveBeenCalledTimes(1);
    expect(relayHealth()).toBe('down');
    await vi.advanceTimersByTimeAsync(RELAY_RETRY_BASE_MS);
    expect(h.relay.start).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RELAY_RETRY_BASE_MS);
    expect(h.relay.start).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RELAY_RETRY_BASE_MS);
    expect(h.relay.start).toHaveBeenCalledTimes(3);
    expect(relayHealth()).toBe('up');
    await c.stop();
  });

  it('http: stop cancela o retry pendente', async () => {
    vi.useFakeTimers();
    h.relay.start.mockRejectedValue(new Error('redis fora'));
    const c = await composeForRole('http');
    await vi.advanceTimersByTimeAsync(0);
    await c.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.relay.start).toHaveBeenCalledTimes(1);
    expect(h.rpcClient.close).toHaveBeenCalledTimes(1);
  });

  it('http: stop durante a tentativa desfaz a assinatura que subir depois', async () => {
    let resolveStart!: () => void;
    h.relay.start.mockImplementationOnce(() => new Promise<void>((r) => { resolveStart = r; }));
    const c = await composeForRole('http');
    await c.stop();
    expect(h.relay.stop).toHaveBeenCalledTimes(1);
    resolveStart();
    await vi.waitFor(() => expect(h.relay.stop).toHaveBeenCalledTimes(2));
    expect(relayHealth()).toBe('down');
  });

  it('http/worker sem S3 configurado falham no boot', async () => {
    h.env.S3_ENABLED = false;
    await expect(composeForRole('http')).rejects.toThrow(/S3/);
    await expect(composeForRole('worker')).rejects.toThrow(/S3/);
  });
});
