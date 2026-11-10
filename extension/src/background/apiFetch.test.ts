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
