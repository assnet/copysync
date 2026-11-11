import { describe, expect, it, vi } from 'vitest';
import { RenderWorkerScaler, parseRetryAfter } from './RenderWorkerScaler';
import { logger } from '../../../../shared/logger/logger';
import {
  ScalerRateLimitedError,
  ScalerServiceNotScalableError,
  ScalerUnavailableError,
} from '../../../../shared/errors/internal/WorkerScalingErrors';

const KEY = 'rnd_fake_key';
const SERVICE = 'srv-abc123';
const BASE = 'http://render.invalid/v1';

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

const service = (details: Record<string, unknown> = {}) => ({
  status: 200,
  body: { id: SERVICE, serviceDetails: { numInstances: 2, autoscaling: null, disk: null, ...details } },
});
const instances = (n: number) => ({ status: 200, body: Array.from({ length: n }, (_, i) => ({ id: `i${i}` })) });

/** `fetchFn` falso: responde por sufixo do caminho; nenhum teste toca a rede. */
function fakeFetch(routes: Record<'service' | 'instances' | 'scale', Reply>) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    const key = url.endsWith('/scale') ? 'scale' : url.endsWith('/instances') ? 'instances' : 'service';
    const reply = routes[key];
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: reply.headers,
    });
  });
}

const scaler = (fetchFn: typeof fetch) => new RenderWorkerScaler({ apiKey: KEY, serviceId: SERVICE, baseUrl: BASE, fetchFn });
const timeoutError = () => Object.assign(new Error('timed out'), { name: 'TimeoutError' });

describe('RenderWorkerScaler.getState', () => {
  it('lê réplicas desejadas, instâncias, disco e autoescala', async () => {
    const fetchFn = fakeFetch({ service: service({ numInstances: 3 }), instances: instances(2), scale: { status: 500 } });
    await expect(scaler(fetchFn).getState()).resolves.toEqual({
      status: 'ready', desiredReplicas: 3, runningReplicas: 2, hasDisk: false, autoscalingEnabled: false,
    });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE}/services/${SERVICE}`);
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it('marca disco e autoescala nativa', async () => {
    const fetchFn = fakeFetch({
      service: service({ disk: { id: 'dsk-1', sizeGB: 1 }, autoscaling: { enabled: true, min: 1, max: 3 } }),
      instances: instances(1),
      scale: { status: 500 },
    });
    await expect(scaler(fetchFn).getState()).resolves.toMatchObject({ hasDisk: true, autoscalingEnabled: true });
  });

  it.each([
    [401, 'auth'], [403, 'auth'], [404, 'not_found'], [500, 'upstream'], [503, 'upstream'], [429, 'rate_limited'],
  ] as const)('HTTP %i vira unavailable/%s sem lançar', async (status, reason) => {
    const fetchFn = fakeFetch({ service: { status }, instances: instances(1), scale: { status: 500 } });
    const extra = reason === 'rate_limited' ? { retryAfterSeconds: null } : {};
    await expect(scaler(fetchFn).getState()).resolves.toEqual({ status: 'unavailable', reason, ...extra });
  });

  it('timeout vira unavailable/timeout', async () => {
    const fetchFn = fakeFetch({ service: service(), instances: timeoutError(), scale: { status: 500 } });
    await expect(scaler(fetchFn).getState()).resolves.toEqual({ status: 'unavailable', reason: 'timeout' });
  });

  it('corpo fora do formato vira unavailable/upstream', async () => {
    const fetchFn = fakeFetch({ service: { status: 200, body: { serviceDetails: {} } }, instances: instances(1), scale: { status: 500 } });
    await expect(scaler(fetchFn).getState()).resolves.toEqual({ status: 'unavailable', reason: 'upstream' });
  });

  it('erro fora de AppError vira unavailable/upstream (nunca relança cru) e loga sem o erro', async () => {
    const warn = vi.fn();
    const child = vi.spyOn(logger, 'child').mockReturnValue({ warn } as unknown as ReturnType<typeof logger.child>);
    const broken = vi.fn(async () => null) as unknown as typeof fetch;
    try {
      await expect(scaler(broken).getState()).resolves.toEqual({ status: 'unavailable', reason: 'upstream' });
      expect(warn).toHaveBeenCalledWith({ op: 'state', reason: 'unexpected' }, expect.any(String));
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain(SERVICE);
      expect(logged).not.toContain(KEY);
      expect(logged).not.toMatch(/null|TypeError/);
    } finally {
      child.mockRestore();
    }
  });

  it('timeout real do AbortSignal (5 s por padrão, aqui curto) aborta a chamada', async () => {
    const hanging = vi.fn((_: unknown, init?: RequestInit) => new Promise<Response>((_r, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
    }));
    const s = new RenderWorkerScaler({ apiKey: KEY, serviceId: SERVICE, baseUrl: BASE, fetchFn: hanging as unknown as typeof fetch, timeoutMs: 10 });
    await expect(s.getState()).resolves.toEqual({ status: 'unavailable', reason: 'timeout' });
  });
});

describe('RenderWorkerScaler.scaleTo', () => {
  it('202 envia numInstances e conclui', async () => {
    const fetchFn = fakeFetch({ service: service(), instances: instances(2), scale: { status: 202 } });
    await expect(scaler(fetchFn).scaleTo(4)).resolves.toBeUndefined();
    const call = fetchFn.mock.calls.find(([u]) => String(u).endsWith('/scale'))!;
    expect(String(call[0])).toBe(`${BASE}/services/${SERVICE}/scale`);
    expect(call[1]!.method).toBe('POST');
    expect(JSON.parse(String(call[1]!.body))).toEqual({ numInstances: 4 });
  });

  it('recusa serviço com disco sem chamar o scale', async () => {
    const fetchFn = fakeFetch({ service: service({ disk: { id: 'dsk-1' } }), instances: instances(1), scale: { status: 202 } });
    await expect(scaler(fetchFn).scaleTo(2)).rejects.toMatchObject({ code: 'SCALER_SERVICE_NOT_SCALABLE', reason: 'disk' });
    expect(fetchFn.mock.calls.some(([u]) => String(u).endsWith('/scale'))).toBe(false);
  });

  it('recusa com autoescala nativa ligada', async () => {
    const fetchFn = fakeFetch({ service: service({ autoscaling: { enabled: true } }), instances: instances(1), scale: { status: 202 } });
    await expect(scaler(fetchFn).scaleTo(2)).rejects.toBeInstanceOf(ScalerServiceNotScalableError);
  });

  it.each([
    [401, 'auth'], [403, 'auth'], [404, 'not_found'], [500, 'upstream'], [502, 'upstream'],
  ] as const)('HTTP %i no scale vira SCALER_UNAVAILABLE/%s', async (status, reason) => {
    const fetchFn = fakeFetch({ service: service(), instances: instances(1), scale: { status } });
    const err = await scaler(fetchFn).scaleTo(2).catch((e) => e);
    expect(err).toBeInstanceOf(ScalerUnavailableError);
    expect(err).toMatchObject({ code: 'SCALER_UNAVAILABLE', statusCode: 503, reason });
  });

  it('429 com Retry-After traz os segundos', async () => {
    const fetchFn = fakeFetch({ service: service(), instances: instances(1), scale: { status: 429, headers: { 'Retry-After': '42' } } });
    const err = await scaler(fetchFn).scaleTo(2).catch((e) => e);
    expect(err).toBeInstanceOf(ScalerRateLimitedError);
    expect(err).toMatchObject({ code: 'SCALER_RATE_LIMITED', statusCode: 429, retryAfterSeconds: 42 });
  });

  it('429 sem Retry-After traz null', async () => {
    const fetchFn = fakeFetch({ service: service(), instances: instances(1), scale: { status: 429 } });
    await expect(scaler(fetchFn).scaleTo(2)).rejects.toMatchObject({ retryAfterSeconds: null });
  });

  it('timeout no scale vira SCALER_UNAVAILABLE/timeout', async () => {
    const fetchFn = fakeFetch({ service: service(), instances: instances(1), scale: timeoutError() });
    await expect(scaler(fetchFn).scaleTo(2)).rejects.toMatchObject({ code: 'SCALER_UNAVAILABLE', reason: 'timeout' });
  });

  it('falha de rede vira upstream', async () => {
    const fetchFn = fakeFetch({ service: new TypeError('fetch failed'), instances: instances(1), scale: { status: 202 } });
    await expect(scaler(fetchFn).scaleTo(2)).rejects.toMatchObject({ reason: 'upstream' });
  });

  it('rejeita alvo inválido sem chamar o provedor', async () => {
    const fetchFn = fakeFetch({ service: service(), instances: instances(1), scale: { status: 202 } });
    await expect(scaler(fetchFn).scaleTo(0)).rejects.toBeInstanceOf(RangeError);
    await expect(scaler(fetchFn).scaleTo(1.5)).rejects.toBeInstanceOf(RangeError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('erro nunca carrega a chave nem o id do serviço', async () => {
    const fetchFn = fakeFetch({ service: service(), instances: instances(1), scale: { status: 403 } });
    const err = (await scaler(fetchFn).scaleTo(2).catch((e) => e)) as Error & { meta?: unknown };
    const text = `${err.message} ${JSON.stringify(err.meta)}`;
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(SERVICE);
  });
});

describe('parseRetryAfter', () => {
  it('segundos, data HTTP, ausente e inválido', () => {
    const now = Date.parse('2026-11-11T12:00:00Z');
    expect(parseRetryAfter('30', now)).toBe(30);
    expect(parseRetryAfter('Wed, 11 Nov 2026 12:01:00 GMT', now)).toBe(60);
    expect(parseRetryAfter('Wed, 11 Nov 2026 11:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
  });
});
