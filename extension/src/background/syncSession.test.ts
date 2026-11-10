import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubChrome, type ChromeStub } from '../__mocks__/chromeStub';

const apiFetch = vi.fn();
vi.mock('./apiFetch.js', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const ML_URL = 'https://www.mercadolivre.com.br/';
const SHEIN_URL = 'https://m.shein.com/';
const SHEIN_ORIGIN = 'https://m.shein.com/*';

let chromeStub: ChromeStub;

const cookie = (name: string, value: string, domain = 'm.shein.com', path = '/') => ({ name, value, path, domain });
const mlCookie = (name: string, value: string) => cookie(name, value, '.mercadolivre.com.br');

beforeEach(() => {
  vi.resetModules();
  apiFetch.mockReset();
  chromeStub = stubChrome();
  chromeStub.cookies[ML_URL] = [mlCookie('ssid', 'ml-token'), mlCookie('orguseridp', '1')];
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
    const { captureCookies } = await import('./marketplaceSession.js');
    // Grava em `shein` o hash REAL do ML: se as chaves vazassem, o ML veria "sem mudança".
    const mlHash = (await captureCookies('ml'))!.hash;
    await store.setCookieHash('shein', mlHash);
    expect(await store.getCookieHash('ml')).toBeUndefined();
    expect((await sync.runSync('cookie-changed', 'ml')).status).toBe('ok');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('alarme: Shein respeita o hash, ML reenvia o mesmo token', async () => {
    apiFetch.mockResolvedValue({});
    const { sync, store } = await load();
    expect((await sync.runSync('manual', 'shein')).status).toBe('ok');
    expect((await sync.runSync('manual', 'ml')).status).toBe('ok');
    await store.setLastSyncEpoch('shein', 0);
    await store.setLastSyncEpoch('ml', 0);
    apiFetch.mockClear();

    expect((await sync.runSync('alarm', 'shein')).status).toBe('idle');
    expect((await sync.runSync('alarm', 'ml')).status).toBe('ok');
    expect(apiFetch.mock.calls.map(c => c[0].path)).toEqual(['/api/extension/marketplaces/ml/session']);

    // Token da Shein mudou → o alarme envia.
    chromeStub.cookies[SHEIN_URL] = [cookie('AT', 'novo'), cookie('memberId', '42')];
    expect((await sync.runSync('alarm', 'shein')).status).toBe('ok');
  });

  it('Shein ignora cookie do domínio pai (.shein.com) mesmo com path maior', async () => {
    chromeStub.cookies[SHEIN_URL] = [
      cookie('AT', 'parent-token', '.shein.com', '/long/path'),
      cookie('AT', 'shein-token'),
      cookie('memberId', '7', '.shein.com'),
      cookie('memberId', '42', '.m.shein.com'),
    ];
    const { captureCookies } = await import('./marketplaceSession.js');
    expect((await captureCookies('shein'))?.cookies).toEqual({ AT: 'shein-token', memberId: '42' });
  });

  it('Shein só no domínio pai → deslogado', async () => {
    chromeStub.cookies[SHEIN_URL] = [cookie('AT', 'x', '.shein.com'), cookie('memberId', '1', '.shein.com')];
    const { captureCookies } = await import('./marketplaceSession.js');
    expect(await captureCookies('shein')).toBeNull();
  });

  it('ML mantém a deduplicação por path sem filtrar domínio', async () => {
    chromeStub.cookies[ML_URL] = [
      mlCookie('ssid', 'short'),
      cookie('ssid', 'long', 'www.mercadolivre.com.br', '/deep'),
    ];
    const { captureCookies } = await import('./marketplaceSession.js');
    expect((await captureCookies('ml'))?.cookies).toEqual({ ssid: 'long' });
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

  it.each(['consent_required', 'plan_unavailable'] as const)(
    '%s na Shein remove a permissão, limpa hash/estado e para o automático', async (code) => {
      const { SyncError } = await import('./errors.js');
      apiFetch.mockResolvedValueOnce({});
      const { sync, store } = await load();
      expect((await sync.runSync('manual', 'shein')).status).toBe('ok');
      apiFetch.mockRejectedValueOnce(new SyncError(code));

      const state = await sync.runSync('channel', 'shein');

      expect(state).toEqual({ status: 'error', lastErrorCode: code });
      expect(chromeStub.remove).toHaveBeenCalledWith({ origins: [SHEIN_ORIGIN] });
      expect(chromeStub.granted.has(SHEIN_ORIGIN)).toBe(false);
      expect(await store.getCookieHash('shein')).toBeUndefined();
      expect(await store.getLastSyncEpoch('shein')).toBe(0);
      expect(await store.isAutoSyncPaused('shein')).toBe(true);

      // Gatilhos automáticos não leem cookie nem chamam a API.
      apiFetch.mockClear();
      chromeStub.getAll.mockClear();
      chromeStub.granted.add(SHEIN_ORIGIN); // nem com a permissão de volta por fora
      for (const t of ['alarm', 'cookie-changed', 'startup'] as const) await sync.runSync(t, 'shein');
      expect(apiFetch).not.toHaveBeenCalled();
      expect(chromeStub.getAll).not.toHaveBeenCalled();

      // Ação do usuário (pedido de acesso + clique → manual) reativa.
      apiFetch.mockResolvedValueOnce({});
      expect((await sync.runSync('manual', 'shein')).status).toBe('ok');
      expect(await store.isAutoSyncPaused('shein')).toBe(false);
    });

  it('500 PLAN_FEATURE_UNAVAILABLE (apiFetch real) não remove a permissão nem pausa', async () => {
    const real = await vi.importActual<typeof import('./apiFetch.js')>('./apiFetch.js');
    apiFetch.mockImplementation((opts) => real.apiFetch(opts));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: false, error: { code: 'PLAN_FEATURE_UNAVAILABLE', message: 'x' } }), { status: 500 })));
    const { sync, store } = await load();
    expect((await sync.runSync('channel', 'shein')).lastErrorCode).toBe('api_rejected');
    expect(chromeStub.remove).not.toHaveBeenCalled();
    expect(chromeStub.granted.has(SHEIN_ORIGIN)).toBe(true);
    expect(await store.isAutoSyncPaused('shein')).toBe(false);
  });

  it.each(['api_unreachable', 'shein_sync_failed'] as const)('%s não remove a permissão nem pausa', async (code) => {
    const { SyncError } = await import('./errors.js');
    apiFetch.mockRejectedValueOnce(new SyncError(code));
    const { sync, store } = await load();
    expect((await sync.runSync('channel', 'shein')).lastErrorCode).toBe(code);
    expect(chromeStub.remove).not.toHaveBeenCalled();
    expect(chromeStub.granted.has(SHEIN_ORIGIN)).toBe(true);
    expect(await store.isAutoSyncPaused('shein')).toBe(false);
  });

  it('manual no ML não grava nada sobre pausa', async () => {
    apiFetch.mockResolvedValueOnce({});
    const { sync } = await load();
    const removeSpy = vi.spyOn(chrome.storage.local, 'remove');
    expect((await sync.runSync('manual', 'ml')).status).toBe('ok');
    expect(removeSpy.mock.calls.flat().flat()).not.toContain('mlAutoSyncPaused');
  });

  it('risk_not_accepted pausa o automático sem remover a permissão', async () => {
    const { SyncError } = await import('./errors.js');
    apiFetch.mockRejectedValueOnce(new SyncError('risk_not_accepted'));
    const { sync, store } = await load();
    expect((await sync.runSync('channel', 'shein')).lastErrorCode).toBe('risk_not_accepted');
    expect(chromeStub.remove).not.toHaveBeenCalled();
    expect(chromeStub.granted.has(SHEIN_ORIGIN)).toBe(true);
    expect(await store.isAutoSyncPaused('shein')).toBe(true);

    apiFetch.mockClear();
    await sync.runSync('alarm', 'shein');
    expect(apiFetch).not.toHaveBeenCalled();

    apiFetch.mockResolvedValueOnce({});
    expect((await sync.runSync('channel', 'shein')).status).toBe('ok');
  });

  it('consent_required no ML não pausa nem remove permissão', async () => {
    const { SyncError } = await import('./errors.js');
    apiFetch.mockRejectedValueOnce(new SyncError('consent_required'));
    const { sync, store } = await load();
    expect((await sync.runSync('manual', 'ml')).lastErrorCode).toBe('consent_required');
    expect(chromeStub.remove).not.toHaveBeenCalled();
    expect(await store.isAutoSyncPaused('ml')).toBe(false);
    apiFetch.mockResolvedValueOnce({});
    expect((await sync.runSync('alarm', 'ml')).status).toBe('ok');
  });

  it('status da Shein não carrega valor de cookie', async () => {
    const { getSheinStatus } = await import('./marketplaceSession.js');
    const status = await getSheinStatus();
    expect(status).toMatchObject({ permission: 'granted', loggedIn: true });
    expect(JSON.stringify(status)).not.toContain('shein-token');
  });
});
