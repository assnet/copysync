import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubChrome } from '../__mocks__/chromeStub';

beforeEach(() => {
  vi.resetModules();
  stubChrome();
});

const respond = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

const codeOf = async (status: number, body: unknown): Promise<string> => {
  respond(status, body);
  const { apiFetch } = await import('./apiFetch.js');
  try {
    await apiFetch({ method: 'PUT', path: '/api/extension/marketplaces/shein/session', body: {} });
  } catch (error) {
    return (error as { code: string }).code;
  }
  return 'none';
};

const forbidden = (code?: string) => ({ success: false, error: code ? { code, message: 'x' } : undefined });

describe('apiFetch 403 por error.code', () => {
  it.each([
    ['SHEIN_CONSENT_REQUIRED', 'consent_required'],
    ['ML_CONSENT_REQUIRED', 'consent_required'],
    ['PLAN_FEATURE_UNAVAILABLE', 'plan_unavailable'],
    ['EXTENSION_NOT_ENTITLED', 'plan_unavailable'],
    ['MARKETPLACE_RISK_NOT_ACCEPTED', 'risk_not_accepted'],
    ['EXTENSION_TENANT_FORBIDDEN', 'forbidden'],
  ])('%s → %s', async (code, kind) => {
    expect(await codeOf(403, forbidden(code))).toBe(kind);
  });

  it('403 sem envelope continua forbidden', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    const { apiFetch } = await import('./apiFetch.js');
    await expect(apiFetch({ path: '/x' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('422 (token não bate) vira api_rejected; 401 segue session_expired', async () => {
    expect(await codeOf(422, forbidden('AFFILIATE_CREDENTIAL_INVALID'))).toBe('api_rejected');
    expect(await codeOf(401, forbidden())).toBe('session_expired');
  });
});

describe('apiFetch: error.code antes do status', () => {
  it('404 SESSION_NOT_FOUND no PUT do ML → api_route_missing (igual à versão anterior)', async () => {
    respond(404, forbidden('SESSION_NOT_FOUND'));
    const { apiFetch } = await import('./apiFetch.js');
    await expect(apiFetch({ method: 'PUT', path: '/api/extension/marketplaces/ml/session', body: {} }))
      .rejects.toMatchObject({ code: 'api_route_missing' });
  });

  it.each([
    'PLAN_FEATURE_UNAVAILABLE', 'EXTENSION_NOT_ENTITLED', 'SHEIN_CONSENT_REQUIRED', 'ML_CONSENT_REQUIRED',
    'MARKETPLACE_RISK_NOT_ACCEPTED',
  ])('5xx com %s → api_rejected (nunca código que revoga/pausa)', async (code) => {
    expect(await codeOf(500, forbidden(code))).toBe('api_rejected');
    expect(await codeOf(503, forbidden(code))).toBe('api_rejected');
  });

  it('404 sem código (rota do Fastify) → api_route_missing', async () => {
    expect(await codeOf(404, { message: 'Route not found', error: 'Not Found', statusCode: 404 })).toBe('api_route_missing');
  });

  it('401 com código de sessão e 429 sem código seguem pelo mapa/status', async () => {
    expect(await codeOf(401, forbidden('INVALID_EXT_SESSION'))).toBe('session_expired');
    expect(await codeOf(429, { success: false })).toBe('rate_limited');
    expect(await codeOf(429, forbidden('RATE_LIMITED'))).toBe('rate_limited');
  });

  it('código de consentimento vale mesmo fora do 403', async () => {
    expect(await codeOf(409, forbidden('SHEIN_CONSENT_REQUIRED'))).toBe('consent_required');
  });

  it.each(['constructor', '__proto__', 'toString'])('código herdado %s não vira mapeamento', async (code) => {
    expect(await codeOf(403, forbidden(code))).toBe('forbidden');
    expect(await codeOf(500, forbidden(code))).toBe('api_rejected');
  });
});
