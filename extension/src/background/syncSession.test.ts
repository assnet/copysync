import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubChrome, type ChromeStub } from '../__mocks__/chromeStub';

const apiFetch = vi.fn();
vi.mock('./apiFetch.js', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const ML_URL = 'https://www.mercadolivre.com.br/';
const SHEIN_URL = 'https://m.shein.com/';
const SHEIN_ORIGIN = 'https://m.shein.com/*';

let chromeStub: ChromeStub;

const cookie = (name: string, value: string) => ({ name, value, path: '/' });

beforeEach(() => {
  vi.resetModules();
  apiFetch.mockReset();
  chromeStub = stubChrome();
  chromeStub.cookies[ML_URL] = [cookie('ssid', 'ml-token'), cookie('orguseridp', '1')];
  chromeStub.cookies[SHEIN_URL] = [cookie('AT', 'shein-token'), cookie('memberId', '42'), cookie('other', 'x')];
  chromeStub.granted.add(SHEIN_ORIGIN);
});

const load = async () => ({
  sync: await import('./syncSession.js'),
  store: await import('./store.js'),
});

describe('runSync por marketplace', () => {
  it('ML e Shein simultâneos não trocam resultado, rota nem hash', async () => {
    apiFetch.mockImplementation(async ({ path }: { path: string }) => {
      if (path.includes('/ml/')) throw new (await import('./errors.js')).SyncError('rate_limited');
      return { affiliateId: '42' };
    });
    const { sync, store } = await load();

    const [ml, shein] = await Promise.all([sync.runSync('manual', 'ml'), sync.runSync('manual', 'shein')]);

    expect(ml).toMatchObject({ status: 'error', lastErrorCode: 'rate_limited' });
    expect(shein.status).toBe('ok');
    const paths = apiFetch.mock.calls.map(c => (c[0] as { path: string }).path).sort();
    expect(paths).toEqual(['/api/extension/marketplaces/ml/session', '/api/extension/marketplaces/shein/session']);
    const sheinBody = apiFetch.mock.calls.find(c => c[0].path.includes('shein'))![0].body;
    expect(sheinBody.cookies).toEqual({ AT: 'shein-token', memberId: '42' });
    expect(await store.getCookieHash('ml')).toBeUndefined();
    expect(await store.getCookieHash('shein')).toMatch(/^[0-9a-f]{64}$/);
    expect((await store.getSyncState('ml')).lastErrorCode).toBe('rate_limited');
    expect((await store.getSyncState('shein')).status).toBe('ok');
  });

  it('rate limit do ML não segura a Shein', async () => {
    apiFetch.mockResolvedValue({});
    const { sync, store } = await load();
    await store.setLastSyncEpoch('ml', Date.now());

    expect((await sync.runSync('alarm', 'ml')).status).toBe('idle');
    expect((await sync.runSync('alarm', 'shein')).status).toBe('ok');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('hash da Shein não faz o ML pular (cookie-changed)', async () => {
    apiFetch.mockResolvedValue({});
    const { sync, store } = await load();
    await sync.runSync('manual', 'shein');
    await store.setCookieHash('ml', 'outro');
    expect((await sync.runSync('cookie-changed', 'ml')).status).toBe('ok');
    expect((await sync.runSync('cookie-changed', 'shein')).status).toBe('idle');
  });

  it('sem AT → shein_not_logged, sem chamar a API', async () => {
    chromeStub.cookies[SHEIN_URL] = [cookie('memberId', '42')];
    const { sync } = await load();
    const state = await sync.runSync('manual', 'shein');
    expect(state).toMatchObject({ status: 'error', lastErrorCode: 'shein_not_logged' });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('Shein sem permissão não lê cookie: manual acusa, alarme sai em silêncio', async () => {
    chromeStub.granted.clear();
    const { sync, store } = await load();

    expect(await sync.runSync('alarm', 'shein')).toEqual({ status: 'idle' });
    expect(await store.getSyncState('shein')).toEqual({ status: 'idle' });
    const manual = await sync.runSync('manual', 'shein');
    expect(manual.lastErrorCode).toBe('shein_permission_missing');

    const { captureCookies, getSheinStatus } = await import('./marketplaceSession.js');
    expect(await captureCookies('shein')).toBeNull();
    const status = await getSheinStatus();
    expect(status).toMatchObject({ permission: 'missing', loggedIn: false, pending: false });
    expect(chromeStub.getAll).not.toHaveBeenCalledWith({ url: SHEIN_URL });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('status da Shein não carrega valor de cookie', async () => {
    const { getSheinStatus } = await import('./marketplaceSession.js');
    const status = await getSheinStatus();
    expect(status).toMatchObject({ permission: 'granted', loggedIn: true });
    expect(JSON.stringify(status)).not.toContain('shein-token');
  });
});
