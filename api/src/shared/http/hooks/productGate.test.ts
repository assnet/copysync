import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createProductGate, type ProductGateMode } from './productGate';
import type { ProductKey } from '../../../modules/tenants/domain/services/resolveProductAccess';

const reply = {} as FastifyReply;
const req = (ctx?: { tenantId: string; isSuperAdmin: boolean }) =>
  ({ tenantContext: ctx && { ...ctx, userId: 'u1', role: 'ADMIN' }, routeOptions: { url: '/x' } }) as unknown as FastifyRequest;
const reader = (has: boolean | Error) => ({
  has: vi.fn(async () => { if (has instanceof Error) throw has; return has; }),
  list: vi.fn(),
  invalidate: vi.fn(),
});
const tenant = { tenantId: 't1', isSuperAdmin: false };

async function outcome(product: ProductKey, mode: ProductGateMode, has: boolean | Error, ctx: typeof tenant | null = tenant) {
  const r = reader(has);
  try {
    await createProductGate(product, r, mode)(req(ctx ?? undefined), reply);
    return { result: 'pass', calls: r.has.mock.calls.length };
  } catch (err) {
    return { result: (err as { statusCode: number; code: string }).code, calls: r.has.mock.calls.length };
  }
}

describe('createProductGate', () => {
  it.each([
    // produto legado
    ['AFFILIATES', 'off', true, 'pass', 0],
    ['AFFILIATES', 'off', false, 'pass', 0],
    ['AFFILIATES', 'log', true, 'pass', 1],
    ['AFFILIATES', 'log', false, 'pass', 1],
    ['AFFILIATES', 'enforce', true, 'pass', 1],
    ['AFFILIATES', 'enforce', false, 'PRODUCT_UNAVAILABLE', 1],
    ['CHAT', 'enforce', false, 'PRODUCT_UNAVAILABLE', 1],
    // produto novo: sempre exigido
    ['SAVER', 'off', true, 'pass', 1],
    ['SAVER', 'off', false, 'PRODUCT_UNAVAILABLE', 1],
    ['SAVER', 'log', false, 'PRODUCT_UNAVAILABLE', 1],
    ['SAVER', 'enforce', false, 'PRODUCT_UNAVAILABLE', 1],
    ['SAVER', 'enforce', true, 'pass', 1],
  ] as const)('%s em %s com acesso=%s → %s', async (product, mode, has, expected, calls) => {
    expect(await outcome(product, mode, has)).toEqual({ result: expected, calls });
  });

  it.each(['off', 'log', 'enforce'] as const)('super admin passa sem consultar (%s)', async (mode) => {
    for (const p of ['AFFILIATES', 'SAVER'] as const) {
      expect(await outcome(p, mode, false, { tenantId: 't1', isSuperAdmin: true })).toEqual({ result: 'pass', calls: 0 });
    }
  });

  it('sem tenantContext passa sem consultar', async () => {
    expect(await outcome('SAVER', 'enforce', false, null)).toEqual({ result: 'pass', calls: 0 });
  });

  it.each([
    ['AFFILIATES', 'enforce', 'SERVICE_TEMPORARILY_UNAVAILABLE'],
    ['AFFILIATES', 'log', 'pass'],
    ['AFFILIATES', 'off', 'pass'],
    ['SAVER', 'off', 'SERVICE_TEMPORARILY_UNAVAILABLE'],
    ['SAVER', 'log', 'SERVICE_TEMPORARILY_UNAVAILABLE'],
    ['SAVER', 'enforce', 'SERVICE_TEMPORARILY_UNAVAILABLE'],
  ] as const)('leitura falhando: %s em %s → %s', async (product, mode, expected) => {
    expect((await outcome(product, mode, new Error('db'))).result).toBe(expected);
  });

  it('403 leva o produto em meta e 503 é genérico', async () => {
    const err403 = await createProductGate('SAVER', reader(false), 'off')(req(tenant), reply).catch((e) => e);
    expect(err403).toMatchObject({ statusCode: 403, meta: { product: 'SAVER' } });
    const err503 = await createProductGate('AFFILIATES', reader(new Error('secret db detail')), 'enforce')(req(tenant), reply).catch((e) => e);
    expect(err503.statusCode).toBe(503);
    expect(err503.message).not.toContain('secret');
  });
});
