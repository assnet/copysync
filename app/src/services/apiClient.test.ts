import { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const realLocation = window.location;
let location: { pathname: string; href: string };

function rejectWith(status: number, code: string): AxiosAdapter {
  return (config: InternalAxiosRequestConfig) =>
    Promise.reject(
      new AxiosError('fail', 'ERR', config, null, {
        status,
        statusText: '',
        headers: {},
        config,
        data: { error: { code, message: 'Tenant is suspended or cancelled' } },
      }),
    );
}

async function load(adapter: AxiosAdapter) {
  vi.resetModules();
  const { apiClient } = await import('./apiClient');
  apiClient.defaults.adapter = adapter;
  return apiClient;
}

beforeEach(() => {
  location = { pathname: '/dashboard', href: 'http://localhost/dashboard' };
  Object.defineProperty(window, 'location', { configurable: true, value: location });
  localStorage.setItem('accessToken', 'tok');
  localStorage.setItem('activeTenantId', 't1');
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  localStorage.clear();
});

describe('apiClient — tenant suspenso', () => {
  it('redireciona para a assinatura de outra rota, sem limpar a sessão', async () => {
    const api = await load(rejectWith(403, 'TENANT_SUSPENDED'));
    await expect(api.get('/sessions')).rejects.toMatchObject({ code: 'TENANT_SUSPENDED', status: 403 });
    expect(location.href).toBe('/settings/subscription?suspended=1');
    expect(localStorage.getItem('accessToken')).toBe('tok');
    expect(localStorage.getItem('activeTenantId')).toBe('t1');
  });

  it('redireciona uma vez só com várias chamadas falhando', async () => {
    const api = await load(rejectWith(403, 'TENANT_SUSPENDED'));
    await expect(api.get('/a')).rejects.toBeTruthy();
    location.href = 'marcado';
    await expect(api.get('/b')).rejects.toBeTruthy();
    expect(location.href).toBe('marcado');
  });

  it('não redireciona estando na própria tela (sem loop)', async () => {
    location.pathname = '/settings/subscription';
    location.href = 'http://localhost/settings/subscription?suspended=1';
    const api = await load(rejectWith(403, 'TENANT_SUSPENDED'));
    await expect(api.get('/subscription')).rejects.toMatchObject({ code: 'TENANT_SUSPENDED' });
    expect(location.href).toBe('http://localhost/settings/subscription?suspended=1');
  });

  it('outro 403 não redireciona para a assinatura', async () => {
    const api = await load(rejectWith(403, 'FORBIDDEN'));
    await expect(api.get('/x')).rejects.toBeTruthy();
    expect(location.href).toBe('http://localhost/dashboard');
  });
});

describe('apiClient — serviço temporariamente indisponível', () => {
  it.each([502, 503, 504])('classifica %i como indisponível', async (status) => {
    const { isServiceUnavailable } = await import('./apiClient');
    const api = await load(rejectWith(status, 'BAD_GATEWAY'));
    const err = await api.get('/admin/workers/settings').catch((e: unknown) => e);
    expect(isServiceUnavailable(err)).toBe(true);
  });

  it('classifica erro de rede (sem resposta) como indisponível', async () => {
    const { isServiceUnavailable } = await import('./apiClient');
    const api = await load((config) => Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config, {})));
    const err = await api.get('/x').catch((e: unknown) => e);
    expect(isServiceUnavailable(err)).toBe(true);
  });

  it.each([400, 401, 409, 500])('não classifica %i', async (status) => {
    const { isServiceUnavailable } = await import('./apiClient');
    const api = await load(rejectWith(status, 'ANY'));
    const err = await api.get('/x').catch((e: unknown) => e);
    expect(isServiceUnavailable(err)).toBe(false);
  });

  it('não classifica requisição cancelada nem erro que não veio do cliente', async () => {
    const { classifyServiceUnavailable, isServiceUnavailable } = await import('./apiClient');
    expect(classifyServiceUnavailable({ code: 'ERR_CANCELED', response: undefined })).toBe(false);
    expect(isServiceUnavailable(new Error('boom'))).toBe(false);
    expect(isServiceUnavailable(null)).toBe(false);
  });
});

describe('apiClient — refresh do token durante deploy', () => {
  /** 1ª chamada à rota protegida: 401; depois, `retried` responde. */
  function protectedThen(retried: AxiosAdapter): AxiosAdapter {
    let calls = 0;
    return (config) => (calls++ === 0 ? rejectWith(401, 'UNAUTHORIZED')(config) : retried(config));
  }

  async function loadWithRefresh(api: AxiosAdapter, refresh: AxiosAdapter) {
    vi.resetModules();
    const axios = (await import('axios')).default;
    const realCreate = axios.create.bind(axios);
    let created = 0;
    // 1º create = apiClient; 2º = cliente do refresh.
    vi.spyOn(axios, 'create').mockImplementation((cfg) => {
      const inst = realCreate(cfg);
      inst.defaults.adapter = created++ === 0 ? api : refresh;
      return inst;
    });
    const mod = await import('./apiClient');
    return mod;
  }

  beforeEach(() => localStorage.setItem('refreshToken', 'rt'));

  it.each([
    ['502', rejectWith(502, 'BAD_GATEWAY')],
    ['rede', ((config: InternalAxiosRequestConfig) => Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config, {}))) as AxiosAdapter],
  ])('refresh com %s não desloga e propaga indisponível', async (_label, refresh) => {
    const { apiClient, isServiceUnavailable } = await loadWithRefresh(protectedThen(rejectWith(500, 'X')), refresh);
    const err = await apiClient.get('/admin/workers').catch((e: unknown) => e);
    expect(isServiceUnavailable(err)).toBe(true);
    expect(location.href).toBe('http://localhost/dashboard');
    expect(localStorage.getItem('accessToken')).toBe('tok');
    expect(localStorage.getItem('refreshToken')).toBe('rt');
  });

  it('refresh 401 continua deslogando', async () => {
    const { apiClient, isServiceUnavailable } = await loadWithRefresh(protectedThen(rejectWith(500, 'X')), rejectWith(401, 'INVALID'));
    const err = await apiClient.get('/admin/workers').catch((e: unknown) => e);
    expect(isServiceUnavailable(err)).toBe(false);
    expect(location.href).toBe('/login');
    expect(localStorage.getItem('refreshToken')).toBeNull();
  });

  it('refresh ok repete a requisição original com o token novo', async () => {
    const seen: string[] = [];
    const ok: AxiosAdapter = (config) => {
      seen.push(String(AxiosHeaders.from(config.headers).get('Authorization')));
      return Promise.resolve({ data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config });
    };
    const refreshOk: AxiosAdapter = (config) =>
      Promise.resolve({ data: { success: true, data: { accessToken: 'novo' } }, status: 200, statusText: 'OK', headers: {}, config });
    const { apiClient } = await loadWithRefresh(protectedThen(ok), refreshOk);
    const res = await apiClient.get('/admin/workers');
    expect(res.data).toEqual({ ok: true });
    expect(seen).toEqual(['Bearer novo']);
    expect(localStorage.getItem('accessToken')).toBe('novo');
  });
});
