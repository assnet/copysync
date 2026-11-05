import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import {
  EngineNotReadyError,
  EngineTemporarilyUnavailableError,
} from '../../../../../shared/errors/internal/MessagingErrors';
import { SessionNotFoundError } from '../../../../../shared/errors/internal/SessionErrors';
import { encodeEngineCall } from '../engineCallCodec';
import { engineCall, type EngineCall, type RpcEngineCall } from '../engineCallPlan';
import type { IEngineCallHandler } from '../ports';
import { ENGINE_RPC_REPLY_PREFIX, RedisEngineRpcClient, RedisEngineRpcServer, engineRpcChannel } from './RedisEngineRpc';

/**
 * Redis LOCAL descartável (`scripts/redis-descartavel.sh start`): INTEGRATION_REDIS_URL=redis://127.0.0.1:<porta>.
 * Sem a variável o arquivo é pulado; host fora de localhost é recusado.
 */
const url = process.env['INTEGRATION_REDIS_URL'];
if (url) {
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`INTEGRATION_REDIS_URL precisa apontar para localhost (recebido: ${host}).`);
  }
}

const clients: Redis[] = [];
const stoppers: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const stop of stoppers) await stop();
  await Promise.all(clients.map((c) => c.quit()));
});

function redis(): Redis {
  const c = new Redis(url!);
  clients.push(c);
  return c;
}

let seq = 0;
async function setup(handler: IEngineCallHandler, timeoutMs = 2000) {
  const workerId = `w-${Date.now()}-${seq++}`;
  const server = new RedisEngineRpcServer({ workerId, subscriber: redis(), publisher: redis(), handler, drainTimeoutMs: 100 });
  await server.start();
  const client = new RedisEngineRpcClient({ publisher: redis(), subscriber: redis(), timeoutMs });
  stoppers.push(() => client.close(), () => server.stop());
  return { workerId, server, client };
}

describe.skipIf(!url)('RedisEngineRpc com Redis real', () => {
  it('ida e volta: argumentos e resultado preservam Buffer e Date', async () => {
    const seen: EngineCall[] = [];
    const at = new Date('2026-11-04T12:00:00.000Z');
    const { workerId, client } = await setup({
      handle: async (call) => {
        seen.push(call);
        return call.method === 'getSessionQr' ? 'qr-123' : { thumb: Buffer.from('jpg'), at };
      },
    });

    await expect(client.call(workerId, engineCall('getSessionQr', 's1'))).resolves.toBe('qr-123');
    const other = (await client.call(workerId, engineCall('fetchProfilePicture', 's1', 'jid@x', false))) as unknown as {
      thumb: Buffer; at: Date;
    };
    expect(Buffer.isBuffer(other.thumb) && other.thumb.toString()).toBe('jpg');
    expect(other.at).toEqual(at);
    expect(seen.map((c) => c.method)).toEqual(['getSessionQr', 'fetchProfilePicture']);
    expect(seen[1]!.args).toEqual(['s1', 'jid@x', false]);
  });

  it('chamadas concorrentes casam pela id', async () => {
    const { workerId, client } = await setup({
      handle: async (call) => {
        const id = call.args[0] as string;
        await new Promise((r) => setTimeout(r, id === 'a' ? 60 : 0));
        return `qr-${id}`;
      },
    });
    const [a, b] = await Promise.all([
      client.call(workerId, engineCall('getSessionQr', 'a')),
      client.call(workerId, engineCall('getSessionQr', 'b')),
    ]);
    expect([a, b]).toEqual(['qr-a', 'qr-b']);
  });

  it('erro do worker volta como a mesma classe interna; erro cru vira 503 genérico', async () => {
    const { workerId, client } = await setup({
      handle: async (call) => {
        if (call.args[0] === 'missing') throw new SessionNotFoundError('missing');
        throw new Error('segredo interno do worker');
      },
    });

    const typed = await client.call(workerId, engineCall('getSessionStatus', 'missing')).catch((e: unknown) => e);
    expect(typed).toBeInstanceOf(SessionNotFoundError);
    expect(typed).toMatchObject({ code: 'SESSION_NOT_FOUND', statusCode: 404, message: 'Session not found: missing' });

    const raw = await client.call(workerId, engineCall('getSessionStatus', 'x')).catch((e: unknown) => e);
    expect(raw).toBeInstanceOf(EngineTemporarilyUnavailableError);
    expect((raw as Error).message).not.toContain('segredo');
  });

  it('método fora do plano rpc é recusado pelo servidor sem chegar ao handler', async () => {
    let called = false;
    const { workerId, client } = await setup({ handle: async () => { called = true; } });
    const notRpc = ({ method: 'logoutSession', args: [{ sessionId: 's1' }] }) as unknown as RpcEngineCall;
    await expect(client.call(workerId, notRpc)).rejects.toBeInstanceOf(EngineTemporarilyUnavailableError);
    expect(called).toBe(false);
  });

  it('sem resposta no prazo → EngineNotReadyError', async () => {
    const { workerId, client } = await setup({ handle: () => new Promise(() => undefined) }, 150);
    const started = Date.now();
    await expect(client.call(workerId, engineCall('getSessionQr', 's1'))).rejects.toBeInstanceOf(EngineNotReadyError);
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  });

  it('ninguém assinando o canal do worker → EngineNotReadyError na hora', async () => {
    const client = new RedisEngineRpcClient({ publisher: redis(), subscriber: redis(), timeoutMs: 5000 });
    stoppers.push(() => client.close());
    const started = Date.now();
    await expect(client.call('worker-ausente', engineCall('getSessionQr', 's1'))).rejects.toBeInstanceOf(
      EngineNotReadyError,
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('close() rejeita pendentes e recusa chamadas novas', async () => {
    const { workerId, client } = await setup({ handle: () => new Promise(() => undefined) }, 5000);
    const pending = client.call(workerId, engineCall('getSessionQr', 's1')).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 50));
    await client.close();
    expect(await pending).toBeInstanceOf(EngineNotReadyError);
    await expect(client.call(workerId, engineCall('getSessionQr', 's1'))).rejects.toBeInstanceOf(EngineNotReadyError);
  });

  it('servidor parado deixa de atender (PUBLISH = 0)', async () => {
    const { workerId, server, client } = await setup({ handle: async () => 'ok' });
    await expect(client.call(workerId, engineCall('getSessionQr', 's1'))).resolves.toBe('ok');
    await server.stop();
    await expect(client.call(workerId, engineCall('getSessionQr', 's1'))).rejects.toBeInstanceOf(EngineNotReadyError);
  });
  it('pedido leva deadline = agora + timeout do cliente', async () => {
    const { workerId, client } = await setup({ handle: async () => 'ok' }, 3000);
    const spy = redis();
    const seen: Array<{ deadline?: number }> = [];
    spy.on('message', (_c: string, m: string) => seen.push(JSON.parse(m) as { deadline?: number }));
    await spy.subscribe(engineRpcChannel(workerId));
    const before = Date.now();
    await expect(client.call(workerId, engineCall('getSessionQr', 's1'))).resolves.toBe('ok');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.deadline).toBeGreaterThanOrEqual(before + 3000);
    expect(seen[0]!.deadline).toBeLessThanOrEqual(Date.now() + 3000);
  });

  it('pedido vencido não executa nem responde; no prazo ou sem deadline executa', async () => {
    const handled: string[] = [];
    const { workerId } = await setup({
      handle: async (call) => { handled.push((call.args[0] as { sessionId: string }).sessionId); return 'ok'; },
    });
    const replyTo = `${ENGINE_RPC_REPLY_PREFIX}t-${Date.now()}`;
    const replies: Array<{ id: string }> = [];
    const sub = redis();
    sub.on('message', (_c: string, m: string) => replies.push(JSON.parse(m) as { id: string }));
    await sub.subscribe(replyTo);
    const pub = redis();
    const send = (id: string, deadline?: number) => pub.publish(engineRpcChannel(workerId), JSON.stringify({
      id, replyTo, call: encodeEngineCall({ method: 'sendReaction', args: [{ sessionId: id, tenantId: 't1', emoji: '👍' }] } as unknown as EngineCall), ...(deadline !== undefined && { deadline }),
    }));
    await send('vencido', Date.now() - 1);
    await send('no-prazo', Date.now() + 5000);
    await send('sem-deadline');
    await new Promise((r) => setTimeout(r, 200));
    expect(handled.sort()).toEqual(['no-prazo', 'sem-deadline']);
    expect(replies.map((r) => r.id).sort()).toEqual(['no-prazo', 'sem-deadline']);
  });
});
