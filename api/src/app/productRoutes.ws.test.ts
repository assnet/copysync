import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { errorHandler } from '../shared/http/errorHandler';
import { sseAuthHook } from '../shared/http/hooks/sseAuthHook';
import type { ProductGateMode } from '../shared/http/hooks/productGate';
import { chatWsRoutes } from '../modules/chat/presentation/routes/chat.ws.routes';
import { insertGateAfterTenantHook, withProduct } from './productRoutes';

vi.mock('../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../shared/http/hooks/sseAuthHook', () => ({
  sseAuthHook: async (request: { tenantContext?: unknown }) => {
    request.tenantContext = { userId: 'user-a', tenantId: 'tenant-a', role: 'ADMIN', isSuperAdmin: false };
  },
}));

/** Conexões persistentes: o gate entra logo após o `sseAuthHook` (abertura do WS do chat e SSE). */
describe('gate na abertura de conexões persistentes', () => {
  let app: FastifyInstance;
  afterEach(async () => { await app?.close(); });

  it('gate logo após sseAuthHook', () => {
    const gate = async () => {};
    expect(insertGateAfterTenantHook([sseAuthHook], gate)).toEqual([sseAuthHook, gate]);
  });

  async function build(mode: ProductGateMode, has: boolean) {
    const reader = { has: vi.fn(async () => has), list: vi.fn(), invalidate: vi.fn() };
    app = Fastify();
    app.setErrorHandler(errorHandler);
    await app.register(websocket);
    await app.register(withProduct('CHAT', chatWsRoutes, { reader, mode }), { prefix: '/api/chat' });
    await app.ready();
    return reader;
  }

  it('enforce sem o produto: abertura do WS do chat negada com 403', async () => {
    const reader = await build('enforce', false);
    const res = await app.inject({ method: 'GET', url: '/api/chat/ws?token=t&tenantId=tenant-a' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'PRODUCT_UNAVAILABLE' } });
    expect(reader.has).toHaveBeenCalledWith('tenant-a', 'CHAT');
  });

  it('off: abertura inalterada (gate não consulta nem bloqueia)', async () => {
    const reader = await build('off', false);
    const res = await app.inject({ method: 'GET', url: '/api/chat/ws?token=t&tenantId=tenant-a' });
    expect(res.statusCode).not.toBe(403);
    expect(reader.has).not.toHaveBeenCalled();
  });
});
