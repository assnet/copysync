import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { CORS_EXPOSED_HEADERS } from './corsPolicy';

describe('CORS_EXPOSED_HEADERS', () => {
  it('expõe X-Server-Time e Retry-After ao painel de outra origem', async () => {
    const app = Fastify();
    await app.register(cors, { origin: true, exposedHeaders: [...CORS_EXPOSED_HEADERS] });
    app.get('/x', async (_req, reply) => reply.header('Retry-After', '5').code(429).send({}));
    const res = await app.inject({ method: 'GET', url: '/x', headers: { origin: 'https://painel.example' } });
    const exposed = String(res.headers['access-control-expose-headers']).split(',').map((h) => h.trim());
    expect(exposed).toEqual(expect.arrayContaining(['X-Server-Time', 'Retry-After']));
    expect(res.headers['retry-after']).toBe('5');
    await app.close();
  });
});
