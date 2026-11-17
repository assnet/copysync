import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import { env } from '../shared/config/env';
import { registerRoutes } from './routes';
import { UNGATED_PRODUCT_ROUTE_EXCEPTIONS, listUngatedProductRoutes } from './productRoutes';

vi.mock('../shared/database/prisma.client', () => {
  const handler: ProxyHandler<object> = { get: () => new Proxy(() => undefined, handler), apply: () => new Proxy(() => undefined, handler) };
  return { prisma: new Proxy({}, handler) };
});

vi.mock('../shared/engine/activeEngine', async (orig) => {
  const stub = (): unknown => new Proxy(() => undefined, { get: () => stub(), apply: () => stub() });
  return { ...(await orig<object>()), getActiveEngine: () => stub() };
});

/**
 * Registra o `routes.ts` real (banco e engine falsos, schemas não compilados) e confere que nenhuma rota de
 * plugin `withProduct` ficou sem gate fora de `UNGATED_PRODUCT_ROUTE_EXCEPTIONS` (`insertGateAfterTenantHook`
 * devolve a rota sem gate quando não acha `tenantHook`/`sseAuthHook`).
 */
describe('rotas de produto sem gate', () => {
  it('toda rota de plugin de produto sem tenantHook/sseAuthHook está na lista de exceções', async () => {
    const app = Fastify();
    // Só o registro importa: schemas não são compilados.
    app.setValidatorCompiler(() => () => true);
    app.setSerializerCompiler(() => (data) => JSON.stringify(data));
    await app.register(rateLimit, { global: false });
    await app.register(jwt, { secret: 'x'.repeat(32) });
    await app.register(websocket);
    await registerRoutes(app);
    await app.ready();
    const found = listUngatedProductRoutes()
      .filter((r) => r.method !== 'HEAD')
      .map((r) => `${r.method} ${r.url.slice(env.API_PREFIX.length)}`);
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((r) => !UNGATED_PRODUCT_ROUTE_EXCEPTIONS.has(r))).toEqual([]);
    // Exceção que deixou de existir sai da lista (a lista não vira cheque em branco).
    expect([...UNGATED_PRODUCT_ROUTE_EXCEPTIONS].filter((r) => !found.includes(r))).toEqual([]);
    await app.close();
  });
});
