import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../shared/http/errorHandler';
import { authHook } from '../shared/http/hooks/authHook';
import { tenantHook } from '../shared/http/hooks/tenantHook';
import type { ProductGateMode } from '../shared/http/hooks/productGate';
import type { ProductKey } from '../modules/tenants/domain/services/resolveProductAccess';
import { ROUTE_PRODUCT_MAP, insertGateAfterTenantHook, withProduct } from './productRoutes';

vi.mock('../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown; headers: Record<string, unknown> }) => {
    request.user = { userId: 'user-a', isSuperAdmin: request.headers['x-super'] === '1' };
  },
}));
vi.mock('../shared/http/hooks/tenantHook', () => ({
  tenantHook: async (request: { user: { isSuperAdmin: boolean }; tenantContext?: unknown }) => {
    request.tenantContext = { userId: 'user-a', tenantId: 'tenant-a', role: 'ADMIN', isSuperAdmin: request.user.isSuperAdmin };
  },
}));

describe('classificação das rotas', () => {
  const source = readFileSync(join(__dirname, 'routes.ts'), 'utf8');
  const calls = [...source.matchAll(/app\.register\(\s*(?:withProduct\('(\w+)',\s*(\w+)\)|(\w+))/g)]
    .map((m) => ({ product: m[1] ?? 'TENANT', name: m[2] ?? m[3]! }));

  it('lê os registros de routes.ts', () => {
    expect(calls.length).toBeGreaterThan(20);
  });

  it('todo app.register de routes.ts está no mapa, com o withProduct da sua classe', () => {
    for (const { name, product } of calls) {
      expect(ROUTE_PRODUCT_MAP[name], `${name} sem classificação em ROUTE_PRODUCT_MAP`).toBeDefined();
      expect(product, `${name} registrado como ${product}, mapa diz ${ROUTE_PRODUCT_MAP[name]}`).toBe(ROUTE_PRODUCT_MAP[name]);
    }
  });

  it('o mapa não tem plugin que não exista em routes.ts', () => {
    const names = new Set(calls.map((c) => c.name));
    expect(Object.keys(ROUTE_PRODUCT_MAP).filter((k) => !names.has(k))).toEqual([]);
  });

  it('sessões, /me, auth, tenants e assinatura nunca passam pelo gate; caçador é de Afiliados', () => {
    for (const k of ['sessionRoutes', 'meRoutes', 'authRoutes', 'tenantRoutes', 'subscriptionRoutes', 'mediaUploadRoutes']) {
      expect(ROUTE_PRODUCT_MAP[k]).toBe('TENANT');
    }
    expect(ROUTE_PRODUCT_MAP['offerHuntRoutes']).toBe('AFFILIATES');
    expect(ROUTE_PRODUCT_MAP['offerHuntAiSuggestRoutes']).toBe('AFFILIATES');
  });
});

describe('insertGateAfterTenantHook', () => {
  const gate = async () => {};
  const other = async () => {};
  it('array novo, gate logo após tenantHook, original intacto', () => {
    const shared = [authHook, tenantHook, other];
    const out = insertGateAfterTenantHook(shared, gate);
    expect(out).toEqual([authHook, tenantHook, gate, other]);
    expect(out).not.toBe(shared);
    expect(shared).toHaveLength(3);
  });
  it('função única e ausência de hook de tenant', () => {
    expect(insertGateAfterTenantHook(tenantHook, gate)).toEqual([tenantHook, gate]);
    expect(insertGateAfterTenantHook(undefined, gate)).toBeUndefined();
    const onlyAuth = [authHook];
    expect(insertGateAfterTenantHook(onlyAuth, gate)).toBe(onlyAuth);
  });
});

describe('withProduct com inject', () => {
  let app: FastifyInstance;
  afterEach(async () => { await app?.close(); });

  const audience = vi.fn(async () => {});
  // Igual aos módulos reais: um único array compartilhado por várias rotas.
  const preHandler = [authHook, tenantHook, audience];

  async function productPlugin(f: FastifyInstance) {
    f.get('/a', { preHandler }, async () => ({ ok: 'a' }));
    f.get('/b', { preHandler }, async () => ({ ok: 'b' }));
    f.get('/public', async () => ({ ok: 'public' }));
    f.get('/auth-only', { preHandler: [authHook] }, async () => ({ ok: 'auth' }));
  }
  async function accountPlugin(f: FastifyInstance) {
    f.get('/sessions', { preHandler: [authHook, tenantHook] }, async () => ({ ok: 'sessions' }));
  }

  async function build(product: ProductKey, mode: ProductGateMode, has: boolean) {
    const reader = { has: vi.fn(async () => has), list: vi.fn(), invalidate: vi.fn() };
    audience.mockClear();
    app = Fastify();
    app.setErrorHandler(errorHandler);
    await app.register(withProduct(product, productPlugin, { reader, mode }), { prefix: '/p' });
    await app.register(accountPlugin, { prefix: '/acc' });
    await app.ready();
    return reader;
  }
  const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers });

  it('enforce sem Afiliados: 403 PRODUCT_UNAVAILABLE antes do portão da rota; gate uma vez por requisição', async () => {
    const reader = await build('AFFILIATES', 'enforce', false);
    const res = await get('/p/a');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'PRODUCT_UNAVAILABLE' } });
    expect(audience).not.toHaveBeenCalled();
    expect((await get('/p/b')).statusCode).toBe(403);
    expect(reader.has).toHaveBeenCalledTimes(2);
    expect(preHandler).toHaveLength(3);
  });

  it.each(['off', 'log'] as const)('%s sem Afiliados: 200', async (mode) => {
    const reader = await build('AFFILIATES', mode, false);
    expect((await get('/p/a')).statusCode).toBe(200);
    expect(reader.has).toHaveBeenCalledTimes(mode === 'off' ? 0 : 1);
    expect(audience).toHaveBeenCalledTimes(1);
  });

  it('com acesso: 200 e o gate roda uma vez por requisição', async () => {
    const reader = await build('AFFILIATES', 'enforce', true);
    expect((await get('/p/a')).statusCode).toBe(200);
    expect((await get('/p/b')).statusCode).toBe(200);
    expect(reader.has).toHaveBeenCalledTimes(2);
  });

  it('rota pública e rota sem tenant do plugin gateado seguem respondendo', async () => {
    const reader = await build('AFFILIATES', 'enforce', false);
    expect((await get('/p/public')).statusCode).toBe(200);
    expect((await get('/p/auth-only')).statusCode).toBe(200);
    expect(reader.has).not.toHaveBeenCalled();
  });

  it('plugin irmão sem withProduct (sessões) nunca é bloqueado', async () => {
    const reader = await build('AFFILIATES', 'enforce', false);
    expect((await get('/acc/sessions')).statusCode).toBe(200);
    expect(reader.has).not.toHaveBeenCalled();
  });

  it('super admin passa', async () => {
    await build('AFFILIATES', 'enforce', false);
    expect((await get('/p/a', { 'x-super': '1' })).statusCode).toBe(200);
  });

  it('produto novo é exigido mesmo em off', async () => {
    await build('SAVER', 'off', false);
    expect((await get('/p/a')).statusCode).toBe(403);
  });
});
