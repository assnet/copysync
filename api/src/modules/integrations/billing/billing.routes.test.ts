import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/* Contrato HTTP do webhook (padrão storefront.routes.test): Fastify de verdade, use case dublê. */
const execute = vi.hoisted(() => vi.fn());
vi.mock('../../../shared/config/env', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../shared/config/env')>();
  return { env: { ...mod.env, BILLING_APPLICATION_KEY: 'app-key', BILLING_APPLICATION_SECRET: 'app-secret', BILLING_APPLICATION_SECRET_PREVIOUS: 'old-secret', BILLING_HMAC_TOLERANCE_SECONDS: 300 } };
});
vi.mock('./ApplyBillingEventUseCase', () => ({
  ApplyBillingEventUseCase: class { execute = execute; },
}));

import { billingRoutes, isValidApplicationKey } from './billing.routes';

const BODY = {
  eventId: 'ev-1', type: 'subscription.activated', seq: 7, occurredAt: '2026-11-02T12:00:00Z', applicationKey: 'app-key',
  externalUserId: 'user-central-1', email: 'ana@exemplo.com', name: 'Ana', planSlug: 'COPYSYNC_PRO',
  permissions: [], expiresAt: null, paidCycles: 1, subscriptionIds: ['sub-1'],
};

function signed(body: unknown, key = 'app-key', secret = 'app-secret') {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  return {
    method: 'POST' as const,
    url: '/billing/webhook',
    payload: raw,
    headers: { 'content-type': 'application/json', 'x-application-key': key, 'x-timestamp': ts, 'x-signature': `sha256=${sig}`, 'x-event-id': 'ev-1' },
  };
}

let app: FastifyInstance;
beforeEach(async () => {
  app = Fastify();
  await app.register(billingRoutes, { prefix: '/billing' });
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

describe('POST /integrations/billing/webhook', () => {
  it('chave de aplicação diferente responde 401 sem processar', async () => {
    const res = await app.inject(signed(BODY, 'outra-chave'));
    expect(res.statusCode).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it('assinatura inválida responde 401', async () => {
    const req = signed(BODY);
    req.headers['x-signature'] = 'sha256=00';
    expect((await app.inject(req)).statusCode).toBe(401);
  });

  it('durante a rotação o segredo anterior ainda é aceito', async () => {
    execute.mockResolvedValue({ outcome: 'APPLIED', tenantId: 't1' });
    expect((await app.inject(signed(BODY, 'app-key', 'old-secret'))).statusCode).toBe(200);
    expect((await app.inject(signed(BODY, 'app-key', 'outro-segredo'))).statusCode).toBe(401);
  });

  it('evento válido chega ao use case com os campos do contrato', async () => {
    execute.mockResolvedValue({ outcome: 'APPLIED', tenantId: 't1' });
    const res = await app.inject(signed(BODY));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, outcome: 'APPLIED' });
    expect(execute).toHaveBeenCalledWith({
      eventId: 'ev-1', billingCustomerId: 'user-central-1', eventType: 'subscription.activated', seq: 7n,
      payload: { email: 'ana@exemplo.com', name: 'Ana', planSlug: 'COPYSYNC_PRO', expiresAt: null },
    });
  });

  it('expiresAt ISO válido chega normalizado; null limpa; ausente não vai', async () => {
    execute.mockResolvedValue({ outcome: 'APPLIED', tenantId: 't1' });
    const payloadOf = () => execute.mock.calls.at(-1)![0].payload;
    await app.inject(signed({ ...BODY, expiresAt: '2026-12-04T12:00:00-03:00' }));
    expect(payloadOf().expiresAt).toBe('2026-12-04T15:00:00.000Z');
    await app.inject(signed({ ...BODY, expiresAt: null }));
    expect(payloadOf().expiresAt).toBeNull();
    const { expiresAt: _omit, ...withoutExpiry } = BODY;
    await app.inject(signed(withoutExpiry));
    expect('expiresAt' in payloadOf()).toBe(false);
  });

  it.each(['abc', 123, '', 'amanhã', true, {}])('expiresAt malformado %j responde 400 sem aplicar o evento', async (bad) => {
    execute.mockClear();
    const res = await app.inject(signed({ ...BODY, expiresAt: bad }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_expires_at' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('tipo desconhecido segue para o use case (recibo IGNORED) e responde 200', async () => {
    execute.mockResolvedValue({ outcome: 'IGNORED' });
    const res = await app.inject(signed({ ...BODY, type: 'invoice.created' }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, outcome: 'IGNORED' });
  });

  it('duplicado concorrente devolvido pelo use case responde 200 DUPLICATE', async () => {
    execute.mockResolvedValue({ outcome: 'DUPLICATE' });
    expect((await app.inject(signed(BODY))).json()).toEqual({ ok: true, outcome: 'DUPLICATE' });
  });

  it('ativação que não dá para provisionar responde 422 com o motivo', async () => {
    execute.mockResolvedValue({ outcome: 'UNPROVISIONABLE', reason: 'missing_email' });
    const res = await app.inject(signed(BODY));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'unprovisionable', reason: 'missing_email' });
  });

  it('evento de corte com a central fora responde 503 (a central retenta)', async () => {
    execute.mockResolvedValue({ outcome: 'HUB_UNAVAILABLE', reason: 'timeout' });
    const res = await app.inject(signed(BODY));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'hub_unavailable' });
  });

  it('desfecho KEPT_ACTIVE responde 200', async () => {
    execute.mockResolvedValue({ outcome: 'KEPT_ACTIVE', tenantId: 't' });
    expect((await app.inject(signed(BODY))).json()).toEqual({ ok: true, outcome: 'KEPT_ACTIVE' });
  });

  it('X-Event-Id diferente do eventId do corpo responde 400 sem processar', async () => {
    const req = signed(BODY);
    req.headers['x-event-id'] = 'ev-outro';
    const res = await app.inject(req);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'event_id_mismatch' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('sem X-Event-Id o evento é aceito', async () => {
    execute.mockResolvedValue({ outcome: 'APPLIED' });
    const req = signed(BODY);
    delete (req.headers as Record<string, string>)['x-event-id'];
    expect((await app.inject(req)).statusCode).toBe(200);
  });

  it('seq em string acima de 2^53 chega ao use case sem perder precisão', async () => {
    execute.mockResolvedValue({ outcome: 'APPLIED' });
    const res = await app.inject(signed({ ...BODY, seq: '9007199254740993' }));
    expect(res.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ seq: 9_007_199_254_740_993n }));
  });

  it('seq número acima de 2^31 é aceito como bigint', async () => {
    execute.mockResolvedValue({ outcome: 'APPLIED' });
    expect((await app.inject(signed({ ...BODY, seq: 2_147_483_648 }))).statusCode).toBe(200);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ seq: 2_147_483_648n }));
  });

  it('seq inválido (não inteiro seguro, negativo, texto) responde 400 sem processar', async () => {
    for (const seq of [1.5, -1, 9007199254740993, 'abc', null]) {
      const res = await app.inject(signed({ ...BODY, seq }));
      expect(res.statusCode, String(seq)).toBe(400);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('sem externalUserId responde 400', async () => {
    const { externalUserId: _omit, ...rest } = BODY;
    expect((await app.inject(signed(rest))).statusCode).toBe(400);
  });
});

describe('isValidApplicationKey', () => {
  it('aceita só a chave idêntica', () => {
    expect(isValidApplicationKey('abc', 'abc')).toBe(true);
    expect(isValidApplicationKey('abd', 'abc')).toBe(false);
    expect(isValidApplicationKey('ab', 'abc')).toBe(false);
    expect(isValidApplicationKey(undefined, 'abc')).toBe(false);
    expect(isValidApplicationKey('abc', undefined)).toBe(false);
  });
});
