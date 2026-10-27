import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serverTimeHook, storageDispositionHook } from './onSendHooks';

/**
 * Regressão do incidente 2026-10-27: dois hooks `onSend` async faziam o Fastify escrever a
 * resposta duas vezes (ERR_HTTP_HEADERS_SENT em promise → processo caía) em (a) handler async
 * que chama `reply.send()` sem `return reply` — o formato de quase todas as rotas — e
 * (b) hook que responde e segue. Os hooks globais precisam ser síncronos.
 */

const rejections: unknown[] = [];
const onRejection = (reason: unknown) => { rejections.push(reason); };

let app: FastifyInstance;

beforeEach(async () => {
  rejections.length = 0;
  process.on('unhandledRejection', onRejection);
  app = Fastify();
  app.addHook('onSend', serverTimeHook);
  app.addHook('onSend', storageDispositionHook('/api/storage/'));
  // (a) handler no formato do projeto: httpResponse.ok(reply, …) sem return
  app.get('/ok', async (_req, reply) => { reply.code(200).send({ ok: true }); });
  // (b) hook que responde sem `return reply`
  const handler = vi.fn(async () => ({ reached: true }));
  app.get('/guarded', { preHandler: [async (_req, reply) => { reply.code(401).send({ no: true }); }] }, handler);
  app.get('/api/storage/f.pdf', async (_req, reply) => { reply.send('x'); });
  await app.ready();
});

afterEach(async () => {
  process.off('unhandledRejection', onRejection);
  await app.close();
});

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('hooks onSend globais', () => {
  it('são síncronos (nunca async) — é o que impede a dupla escrita', () => {
    expect(serverTimeHook.constructor.name).toBe('Function');
    expect(storageDispositionHook('/x/').constructor.name).toBe('Function');
  });

  it('handler que envia sem return: uma resposta, com X-Server-Time, sem rejeição', async () => {
    const before = Date.now();
    const res = await app.inject({ method: 'GET', url: '/ok' });
    await settle();
    expect(res.statusCode).toBe(200);
    expect(Number(res.headers['x-server-time'])).toBeGreaterThanOrEqual(before);
    expect(rejections).toEqual([]);
  });

  it('hook que responde e segue: 401 e sem rejeição', async () => {
    const res = await app.inject({ method: 'GET', url: '/guarded' });
    await settle();
    expect(res.statusCode).toBe(401);
    expect(rejections).toEqual([]);
  });

  it('storage com ?name=: Content-Disposition com o nome pedido', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/storage/f.pdf?name=nota.pdf' });
    expect(res.headers['content-disposition']).toContain('nota.pdf');
    const other = await app.inject({ method: 'GET', url: '/ok' });
    expect(other.headers['content-disposition']).toBeUndefined();
  });
});
