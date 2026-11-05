import { usesRedis, type ProcessRole } from '../shared/config/processRole';
import type { IMessagingEngine } from '../modules/messaging/domain/contracts/IMessagingEngine';
import { env } from '../shared/config/env';
import { logger } from '../shared/logger/logger';

/** Engine do papel e como parar o que a composição ligou. */
export interface RoleComposition {
  /** A mesma que `getActiveEngine()` devolve depois da composição. */
  engine: IMessagingEngine;
  /**
   * Fecha consumidores BullMQ, servidor/cliente RPC e o relay `deliver`. Não fecha sockets nem
   * Redis (`closeAllSockets`/`closeAllRedis` são do shutdown, WROLE-15). Idempotente; nunca lança.
   */
  stop(): Promise<void>;
}

type Stopper = () => Promise<unknown>;

/**
 * Composição de engine e eventos do painel por papel (WROLE-02/05/12).
 * - `all`: `localEngine()` como hoje; não importa Redis nem módulos remotos.
 * - `worker`: `localEngine()` + `EngineCommandServer` atendendo RPC (`engine-rpc:{workerId}`) e as filas
 *   BullMQ (`engine-cmd-{workerId}`, `session-open`); WS vira `PUBLISH tenant:{id}`.
 * - `http`: `RemoteMessagingEngineAdapter` como engine ativa (nunca chama `localEngine()`, nem carrega
 *   Baileys/GramJS); `PSUBSCRIBE tenant:*` entrega aos WS locais.
 * Módulos por `import()` dinâmico: cada papel só carrega o que usa.
 */
export async function composeForRole(role: ProcessRole): Promise<RoleComposition> {
  if (role === 'all') {
    const { localEngine } = await import('../modules/messaging/infrastructure/localEngineContainer');
    return { engine: localEngine(), stop: async () => undefined };
  }
  await bindRedis(role);
  return role === 'worker' ? composeWorker() : composeHttp();
}

async function bindRedis(role: ProcessRole): Promise<void> {
  const { bindRedisAccess } = await import('../shared/redis/redisConnections');
  bindRedisAccess({
    enabled: () => usesRedis(role),
    url: () => env.REDIS_URL,
    onError: (client, err) => logger.warn({ err, client }, 'Redis: erro de conexão'),
  });
}

async function outboundMediaTransfer() {
  if (!env.S3_ENABLED) {
    throw new Error('PROCESS_ROLE http/worker exige S3 configurado (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)');
  }
  const { OutboundMediaTransfer, S3OutboundObjectStore } = await import(
    '../modules/messaging/infrastructure/remote/outboundMediaTransfer'
  );
  return new OutboundMediaTransfer(new S3OutboundObjectStore({
    endpoint:        env.S3_ENDPOINT!,
    bucket:          env.S3_BUCKET!,
    region:          env.S3_REGION,
    accessKeyId:     env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    publicUrl:       env.S3_PUBLIC_URL,
  }));
}

async function composeWorker(): Promise<RoleComposition> {
  const [{ localEngine }, { sessionLeaseContainer }, redis, { EngineCommandServer }, { RedisEngineRpcServer }, { BullEngineCommandQueues }, ws, { RedisChatEventRelay }] =
    await Promise.all([
      import('../modules/messaging/infrastructure/localEngineContainer'),
      import('../modules/sessions/infrastructure/lease/sessionLeaseContainer'),
      import('../shared/redis/redisConnections'),
      import('../modules/messaging/infrastructure/remote/EngineCommandServer'),
      import('../modules/messaging/infrastructure/remote/transport/RedisEngineRpc'),
      import('../modules/messaging/infrastructure/remote/transport/BullEngineCommandQueues'),
      import('../modules/chat/infrastructure/ws/ChatWebSocketPublisher'),
      import('../modules/chat/infrastructure/ws/RedisChatEventRelay'),
    ]);

  const engine = localEngine();
  const lease = sessionLeaseContainer();
  const handler = new EngineCommandServer(engine, engine, lease.release, await outboundMediaTransfer());
  const rpcServer = new RedisEngineRpcServer({
    workerId: lease.workerId,
    subscriber: redis.redisSubscriber(),
    publisher: redis.redisCommand(),
    handler,
  });
  const queues = new BullEngineCommandQueues({ connection: redis.bullConnection() });

  const stoppers: Stopper[] = [];
  try {
    await rpcServer.start();
    stoppers.push(() => rpcServer.stop());
    queues.startConsumers(lease.workerId, handler);
    stoppers.push(() => queues.close());
  } catch (err) {
    await stopAll(stoppers);
    throw err;
  }
  // Relay fica ligado depois do `stop()`: o fechamento dos sockets ainda publica status.
  ws.chatWsPublisher.setRelay(new RedisChatEventRelay({ mode: 'publish', client: redis.redisCommand() }));
  logger.info({ role: 'worker', workerId: lease.workerId }, 'Engine local atendendo RPC e filas de comando');
  return { engine, stop: once(() => stopAll(stoppers)) };
}

async function composeHttp(): Promise<RoleComposition> {
  const [{ sessionLeaseContainer }, redis, { RedisEngineRpcClient }, { BullEngineCommandQueues }, remote, ws, { RedisChatEventRelay }, { setActiveEngine }, { SecretCipherFactory }, { currentWorkerId }] =
    await Promise.all([
      import('../modules/sessions/infrastructure/lease/sessionLeaseContainer'),
      import('../shared/redis/redisConnections'),
      import('../modules/messaging/infrastructure/remote/transport/RedisEngineRpc'),
      import('../modules/messaging/infrastructure/remote/transport/BullEngineCommandQueues'),
      import('../modules/messaging/infrastructure/remote/RemoteMessagingEngineAdapter'),
      import('../modules/chat/infrastructure/ws/ChatWebSocketPublisher'),
      import('../modules/chat/infrastructure/ws/RedisChatEventRelay'),
      import('../shared/engine/activeEngine'),
      import('../shared/security/SecretCipherFactory'),
      import('../shared/config/workerIdentity'),
    ]);

  const rpc = new RedisEngineRpcClient({
    publisher: redis.redisCommand(),
    subscriber: redis.redisSubscriber(),
    processId: currentWorkerId(),
  });
  const commands = new BullEngineCommandQueues({ connection: redis.bullConnection() });
  const engine = new remote.RemoteMessagingEngineAdapter({
    owners: sessionLeaseContainer().repo,
    rpc,
    commands,
    mediaTransfer: await outboundMediaTransfer(),
    enabledEngines: remote.enabledEnginesFromEnv({
      telegramEnabled: env.TELEGRAM_ENGINE_ENABLED,
      telegramApiId:   env.TELEGRAM_API_ID,
      telegramApiHash: env.TELEGRAM_API_HASH,
      cipherProblem:   SecretCipherFactory.check(),
    }),
  });
  setActiveEngine(engine);

  const stoppers: Stopper[] = [() => rpc.close(), () => commands.close()];
  const relay = new RedisChatEventRelay({
    mode: 'deliver',
    client: redis.redisSubscriber(),
    deliver: (tenantId, payload) => ws.chatWsPublisher.deliverLocal(tenantId, payload),
  });
  try {
    await relay.start();
    stoppers.unshift(() => relay.stop());
  } catch (err) {
    await stopAll(stoppers);
    throw err;
  }
  logger.info({ role: 'http' }, 'Engine remota: comandos ao worker dono por Redis');
  return { engine, stop: once(() => stopAll(stoppers)) };
}

/** Em ordem; falha de um não impede os seguintes (shutdown não pode travar). */
async function stopAll(stoppers: readonly Stopper[]): Promise<void> {
  for (const stop of stoppers) {
    try {
      await stop();
    } catch (err) {
      logger.warn({ err }, 'Composição por papel: falha ao parar componente');
    }
  }
}

function once(fn: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | undefined;
  return () => (running ??= fn());
}
