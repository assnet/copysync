import { describe, expect, it, vi } from 'vitest';
import vector from '../../../../shared/http/m2m/__fixtures__/m2m-vector.json';
import { buildM2MCanonical, signM2MCanonical, signM2MRequest } from '../../../../shared/http/m2m/m2mSignature';
import { HubSubscriptionsClient } from './HubSubscriptionsClient';

const ID = '3f1c2a9e-1b4d-4c8e-9a10-5d6e7f8a9b0c';
const config = { hubUrl: 'https://hub.example.com', applicationKey: 'copysync', secret: 'm2m-secret' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const okBody = (o: Record<string, unknown> = {}) => ({
  externalUserId: ID,
  subscriptions: [{ id: 's1', planSlug: 'copysync-pro-mensal', permissions: ['x'], billingStatus: 'ACTIVE', expiresAt: null, paidCycles: 1, deletedAt: null, orderId: null }],
  lastSeq: 42,
  ...o,
});
const client = (fetchFn: ReturnType<typeof vi.fn>, hubUrl = config.hubUrl) =>
  new HubSubscriptionsClient({ ...config, hubUrl, timeoutMs: 50 }, fetchFn as unknown as typeof fetch);

describe('HubSubscriptionsClient', () => {
  it('assinatura do GET bate com o vetor oficial da central', () => {
    const v = vector.vectors.find((x) => x.name === 'get-sem-corpo')!;
    const headers = signM2MRequest({
      method: v.method, path: v.path, query: v.query, applicationKey: 'k', secret: vector.secret,
      nowMs: Number(v.timestamp) * 1000, nonce: v.nonce,
    });
    expect(headers['X-Signature']).toBe(v.expectedSignature);
  });

  it('200: GET assinado com a query na canônica; snapshot com lastSeq bigint', async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply(200, okBody()));
    const r = await client(fetchFn, 'https://hub.example.com/api/').fetchByCustomer(ID);
    expect(r).toEqual({
      ok: true,
      snapshot: { externalUserId: ID, lastSeq: 42n, subscriptions: [{ id: 's1', planSlug: 'copysync-pro-mensal', billingStatus: 'ACTIVE', expiresAt: null, deletedAt: null }] },
    });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://hub.example.com/api/integrations/subscriptions?externalUserId=${ID}`);
    expect(init.method).toBe('GET');
    const h = init.headers as Record<string, string>;
    expect(h['X-Application-Key']).toBe('copysync');
    const canonical = buildM2MCanonical({ method: 'GET', path: '/api/integrations/subscriptions', query: `externalUserId=${ID}`, timestamp: h['X-Timestamp']!, nonce: h['X-Nonce']! });
    expect(h['X-Signature']).toBe(signM2MCanonical('m2m-secret', canonical));
  });

  it('canceledAt/refundedAt/chargedbackAt opcionais: presentes passam adiante, tipo errado é inválido', async () => {
    const withCancel = okBody({ subscriptions: [{ ...okBody().subscriptions[0], canceledAt: '2026-11-07T10:00:00Z', refundedAt: null }] });
    const r = await client(vi.fn().mockResolvedValue(reply(200, withCancel))).fetchByCustomer(ID);
    expect(r.ok && r.snapshot.subscriptions[0]).toMatchObject({ canceledAt: '2026-11-07T10:00:00Z', refundedAt: null });
    expect(r.ok && 'chargedbackAt' in r.snapshot.subscriptions[0]!).toBe(false);
    const bad = okBody({ subscriptions: [{ ...okBody().subscriptions[0], canceledAt: 1 }] });
    expect(await client(vi.fn().mockResolvedValue(reply(200, bad))).fetchByCustomer(ID)).toMatchObject({ ok: false, reason: 'invalid_response' });
  });

  it('lastSeq null aceito', async () => {
    const r = await client(vi.fn().mockResolvedValue(reply(200, okBody({ lastSeq: null })))).fetchByCustomer(ID);
    expect(r.ok && r.snapshot.lastSeq).toBeNull();
  });

  it.each([
    [401, 'unauthorized'], [403, 'unauthorized'], [400, 'http_error'], [500, 'http_error'],
  ])('HTTP %i → %s', async (status, reason) => {
    expect(await client(vi.fn().mockResolvedValue(reply(status, { ok: false }))).fetchByCustomer(ID)).toEqual({ ok: false, reason, status });
  });

  it('resposta inválida: outro cliente, lastSeq fracionário, item malformado', async () => {
    for (const body of [okBody({ externalUserId: 'outro' }), okBody({ lastSeq: 1.5 }), okBody({ subscriptions: [{ id: 1 }] }), 'x']) {
      const r = await client(vi.fn().mockResolvedValue(reply(200, body))).fetchByCustomer(ID);
      expect(r).toMatchObject({ ok: false, reason: 'invalid_response' });
    }
  });

  it('timeout e rede viram motivo, nunca lançam', async () => {
    const slow = vi.fn((_u: string, init: RequestInit) => new Promise((_r, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    }));
    expect(await client(slow).fetchByCustomer(ID)).toEqual({ ok: false, reason: 'timeout' });
    expect(await client(vi.fn().mockRejectedValue(new TypeError('fetch failed'))).fetchByCustomer(ID)).toEqual({ ok: false, reason: 'network' });
  });
});
