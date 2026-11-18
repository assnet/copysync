import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { USAGE_READ_TIMEOUT_MS, adminUsageService, resetUsageReadQueue } from './adminUsage.service';
import { apiClient } from './apiClient';

vi.mock('./apiClient', () => ({ apiClient: { get: vi.fn() } }));

const get = vi.mocked(apiClient.get);

interface Pending { url: string; params: Record<string, string>; resolve: (v: unknown) => void; reject: (e: unknown) => void }
let pending: Pending[];
let inFlight: number;
let maxInFlight: number;

beforeEach(() => {
  resetUsageReadQueue();
  pending = [];
  inFlight = 0;
  maxInFlight = 0;
  get.mockReset();
  get.mockImplementation(((url: string, config?: { params?: Record<string, string> }) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise((resolve, reject) => {
      const done = () => { inFlight -= 1; };
      pending.push({
        url,
        params: config?.params ?? {},
        resolve: (v) => { done(); resolve({ data: { data: v } }); },
        reject: (e) => { done(); reject(e); },
      });
    });
  }) as unknown as typeof apiClient.get);
});

afterEach(() => {
  resetUsageReadQueue();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('fila de leituras de uso', () => {
  it('uma leitura por vez entre os cinco canais (resumo, tendência, detalhe, contas e telas); a próxima sai quando a anterior termina', async () => {
    const a = adminUsageService.getSummary({ from: '1' });
    const b = adminUsageService.getDetail('offer_hunter', { from: '1' }, 'trend');
    const c = adminUsageService.getDetail('offer_generator', { from: '1' });
    const d = adminUsageService.getTenants('offer_generator', { from: '1' });
    const e = adminUsageService.getScreens({ from: '1' });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    for (const value of ['s', 't', 'd', 'l', 'v']) {
      pending[pending.length - 1].resolve(value);
      await flush();
    }
    await expect(Promise.all([a, b, c, d, e])).resolves.toEqual(['s', 't', 'd', 'l', 'v']);
    expect(get.mock.calls.map((call) => call[0])).toEqual([
      '/admin/usage/summary',
      '/admin/usage/features/offer_hunter',
      '/admin/usage/features/offer_generator',
      '/admin/usage/features/offer_generator/tenants',
      '/admin/usage/screens',
    ]);
    expect(maxInFlight).toBe(1);
  });

  it('telas usam canal próprio na mesma fila: esperam a leitura em voo e o pedido superado de telas é descartado', async () => {
    const summary = adminUsageService.getSummary({ from: '1' });
    const old = adminUsageService.getScreens({ from: '1' });
    const fresh = adminUsageService.getScreens({ from: '2' });
    await expect(old).rejects.toMatchObject({ code: 'USAGE_READ_SUPERSEDED' });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    pending[0].resolve('s');
    await flush();
    expect(get.mock.calls[1][0]).toBe('/admin/usage/screens');
    expect(get.mock.calls[1][1]).toMatchObject({ params: { from: '2' }, timeout: USAGE_READ_TIMEOUT_MS });
    pending[1].resolve('telas');
    await expect(Promise.all([summary, fresh])).resolves.toEqual(['s', 'telas']);
    expect(maxInFlight).toBe(1);
  });

  it('pedido superado no mesmo canal é descartado antes de ir à rede', async () => {
    const first = adminUsageService.getSummary({ from: '1' });
    const second = adminUsageService.getSummary({ from: '2' });
    const third = adminUsageService.getSummary({ from: '3' });
    await expect(second).rejects.toMatchObject({ code: 'USAGE_READ_SUPERSEDED' });
    pending[0].resolve('um');
    await flush();
    pending[1].resolve('três');
    await expect(first).resolves.toBe('um');
    await expect(third).resolves.toBe('três');
    expect(get.mock.calls.map((call) => (call[1] as { params: Record<string, string> }).params.from)).toEqual(['1', '3']);
    expect(maxInFlight).toBe(1);
  });

  it('mesma chave do pedido em voo ainda descarta o enfileirado do canal com outra chave', async () => {
    const k1 = adminUsageService.getSummary({ from: '1' });
    const k2 = adminUsageService.getSummary({ from: '2' });
    const again = adminUsageService.getSummary({ from: '1' });
    expect(again).toBe(k1);
    await expect(k2).rejects.toMatchObject({ code: 'USAGE_READ_SUPERSEDED' });
    pending[0].resolve('um');
    await flush();
    await expect(k1).resolves.toBe('um');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('mesma chave em voo ou na fila reaproveita a promessa (StrictMode)', async () => {
    const a = adminUsageService.getSummary({ from: '1', to: '2' });
    const b = adminUsageService.getSummary({ to: '2', from: '1' });
    expect(b).toBe(a);
    const c = adminUsageService.getDetail('x', { from: '1' });
    const d = adminUsageService.getDetail('x', { from: '1' });
    expect(d).toBe(c);
    pending[0].resolve('ok');
    await flush();
    pending[1].resolve('det');
    await expect(d).resolves.toBe('det');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('erro não trava a fila e não tem retry automático', async () => {
    const a = adminUsageService.getSummary({ from: '1' });
    const b = adminUsageService.getDetail('x', { from: '1' });
    pending[0].reject({ code: 'USAGE_METRICS_READ_UNAVAILABLE' });
    await expect(a).rejects.toMatchObject({ code: 'USAGE_METRICS_READ_UNAVAILABLE' });
    await flush();
    pending[1].resolve('det');
    await expect(b).resolves.toBe('det');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('as quatro leituras levam timeout de 8 s; timeout é falha comum e a fila anda', async () => {
    const a = adminUsageService.getSummary({ from: '1' });
    const b = adminUsageService.getDetail('x', { from: '1' }, 'trend');
    const c = adminUsageService.getDetail('x', { from: '1' });
    const d = adminUsageService.getTenants('x', { from: '1' });
    pending[0].reject({ code: 'ECONNABORTED', message: 'timeout of 8000ms exceeded' });
    await expect(a).rejects.toMatchObject({ code: 'ECONNABORTED' });
    for (const value of ['t', 'd', 'l']) {
      await flush();
      pending[pending.length - 1].resolve(value);
    }
    await expect(Promise.all([b, c, d])).resolves.toEqual(['t', 'd', 'l']);
    expect(USAGE_READ_TIMEOUT_MS).toBe(8000);
    expect(get).toHaveBeenCalledTimes(4);
    for (const call of get.mock.calls) expect(call[1]).toMatchObject({ timeout: 8000 });
  });
});
