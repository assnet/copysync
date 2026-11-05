import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
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
