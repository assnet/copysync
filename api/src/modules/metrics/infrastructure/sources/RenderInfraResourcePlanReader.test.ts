import { describe, expect, it, vi } from 'vitest';
import {
  RenderInfraResourcePlanReader,
  bandwidthUnitToGb,
  infraResourceDriftFields,
} from './RenderInfraResourcePlanReader';
import { createInfraResourcePlanReader } from './infraResourcePlanReader';
import { NotConfiguredInfraResourcePlanReader } from './NotConfiguredInfraResourcePlanReader';
import { logger } from '../../../../shared/logger/logger';
import type { InfraRenderKey } from '../../domain/services/infraCostSettings';

const KEY = 'rnd_fake_key';
const BASE = 'http://render.invalid/v1';
const RES = new Map<InfraRenderKey, string>([
  ['api', 'srv-teste'],
  ['static', 'srv-teste2'],
  ['postgres', 'dpg-teste'],
  ['redis', 'red-teste'],
]);

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

/** `fetchFn` falso: `route(url)` decide a resposta; nenhum teste toca a rede. */
function fakeFetch(route: (url: URL) => Reply) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const reply = route(new URL(String(input)));
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: reply.headers,
    });
  });
}

const reader = (fetchFn: typeof fetch, resources = RES) =>
  new RenderInfraResourcePlanReader({ apiKey: KEY, resources, baseUrl: BASE, fetchFn });
const timeoutError = () => Object.assign(new Error('timed out'), { name: 'TimeoutError' });
const ok = (body: unknown): Reply => ({ status: 200, body });

const H0 = new Date('2026-11-12T10:00:00.000Z');
const H1 = new Date('2026-11-12T11:00:00.000Z');
const series = (service: string, value: number, unit?: string, ts = '2026-11-12T10:00:00Z') => ({
  labels: [{ field: 'service', value: service }],
  values: [{ timestamp: ts, value }],
  ...(unit === undefined ? {} : { unit }),
});

describe('RenderInfraResourcePlanReader.readResource', () => {
  it('serviço: plano, instâncias, disco e suspenso, com a chave só no header', async () => {
    const fetchFn = fakeFetch(() =>
      ok({ id: 'srv-teste', suspended: 'not_suspended', serviceDetails: { plan: 'standard', numInstances: 2, disk: { sizeGB: 10 } } }),
    );
    await expect(reader(fetchFn).readResource('api')).resolves.toEqual({
      status: 'ok',
      reading: { resourceKey: 'api', resourceType: 'service', plan: 'standard', instances: 2, diskGb: 10, suspended: false },
    });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE}/services/srv-teste`);
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it('serviço suspenso e sem disco', async () => {
    const fetchFn = fakeFetch(() => ok({ suspended: 'suspended', serviceDetails: { plan: 'starter', numInstances: 1, disk: null } }));
    await expect(reader(fetchFn).readResource('api')).resolves.toMatchObject({
      status: 'ok', reading: { suspended: true, diskGb: null, plan: 'starter' },
    });
  });

  it('Postgres: plano, diskSizeGB e status', async () => {
    const fetchFn = fakeFetch(() => ok({ plan: 'basic_1gb', diskSizeGB: 15, status: 'available' }));
    await expect(reader(fetchFn).readResource('postgres')).resolves.toEqual({
      status: 'ok',
      reading: { resourceKey: 'postgres', resourceType: 'postgres', plan: 'basic_1gb', instances: 1, diskGb: 15, suspended: false },
    });
    expect(String(fetchFn.mock.calls[0]![0])).toBe(`${BASE}/postgres/dpg-teste`);
  });

  it('Key Value: plano lido, campo ausente = desconhecido', async () => {
    const fetchFn = fakeFetch(() => ok({ plan: 'starter' }));
    await expect(reader(fetchFn).readResource('redis')).resolves.toEqual({
      status: 'ok',
      reading: { resourceKey: 'redis', resourceType: 'key_value', plan: 'starter', instances: 1, diskGb: null, suspended: null },
    });
    expect(String(fetchFn.mock.calls[0]![0])).toBe(`${BASE}/key-value/red-teste`);
    const suspended = fakeFetch(() => ok({ status: 'suspended' }));
    await expect(reader(suspended).readResource('redis')).resolves.toMatchObject({ reading: { plan: null, suspended: true } });
  });

  it('chave sem id mapeado não chama a Render', async () => {
    const fetchFn = fakeFetch(() => ok({}));
    await expect(reader(fetchFn).readResource('worker')).resolves.toEqual({ status: 'unavailable', reason: 'not_configured' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('429 respeita Retry-After e, sem ele, Ratelimit-Reset', async () => {
    const retry = fakeFetch(() => ({ status: 429, headers: { 'Retry-After': '30', 'Ratelimit-Reset': '50' } }));
    await expect(reader(retry).readResource('api')).resolves.toEqual({ status: 'unavailable', reason: 'rate_limited', retryAfterSeconds: 30 });
    const reset = fakeFetch(() => ({
      status: 429, headers: { 'Ratelimit-Limit': '400', 'Ratelimit-Remaining': '0', 'Ratelimit-Reset': '42' },
    }));
    await expect(reader(reset).readResource('api')).resolves.toEqual({ status: 'unavailable', reason: 'rate_limited', retryAfterSeconds: 42 });
    const none = fakeFetch(() => ({ status: 429 }));
    await expect(reader(none).readResource('api')).resolves.toEqual({ status: 'unavailable', reason: 'rate_limited', retryAfterSeconds: null });
  });

  it.each([
    [401, 'auth'], [403, 'auth'], [404, 'not_found'], [400, 'rejected_by_provider'], [503, 'upstream'],
  ] as const)('HTTP %i vira %s', async (status, reason) => {
    await expect(reader(fakeFetch(() => ({ status }))).readResource('api')).resolves.toEqual({ status: 'unavailable', reason });
  });

  it('timeout, rede e corpo inválido viram unavailable sem id no log', async () => {
    const warn = vi.spyOn(logger, 'child').mockReturnValue({ warn: vi.fn(), debug: vi.fn() } as never);
    const r = reader(fakeFetch(() => timeoutError()));
    await expect(r.readResource('api')).resolves.toEqual({ status: 'unavailable', reason: 'timeout' });
    await expect(reader(fakeFetch(() => new Error('fetch failed srv-teste'))).readResource('api'))
      .resolves.toEqual({ status: 'unavailable', reason: 'upstream' });
    await expect(reader(fakeFetch(() => ok('nada'))).readResource('api'))
      .resolves.toEqual({ status: 'unavailable', reason: 'upstream' });
    const childLog = warn.mock.results[0]!.value as { warn: ReturnType<typeof vi.fn> };
    expect(childLog.warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.results.map((x) => (x.value as { warn: ReturnType<typeof vi.fn> }).warn.mock.calls)))
      .not.toMatch(/srv-|dpg-|red-|rnd_/);
  });
});

describe('RenderInfraResourcePlanReader.readBandwidthGb', () => {
  it('pede todos os serviços com resource repetido, sem resolution, e converte pelo unit', async () => {
    const fetchFn = fakeFetch(() => ok([series('srv-teste', 2_500_000_000, 'bytes'), series('srv-teste2', 0.5, 'GB')]));
    await expect(reader(fetchFn).readBandwidthGb(H0, H1)).resolves.toEqual({
      status: 'ok', byKey: { api: 2.5, static: 0.5 }, discardedSeries: 0,
    });
    const url = new URL(String(fetchFn.mock.calls[0]![0]));
    expect(url.pathname).toBe('/v1/metrics/bandwidth');
    expect(url.searchParams.getAll('resource')).toEqual(['srv-teste', 'srv-teste2']);
    expect(url.searchParams.get('startTime')).toBe(H0.toISOString());
    expect(url.searchParams.get('endTime')).toBe(H1.toISOString());
    expect(url.searchParams.has('resolution')).toBe(false);
    expect(url.searchParams.has('resolutionSeconds')).toBe(false);
  });

  it('série sem unit é descartada; serviço sem série fica null; ponto fora da janela não soma', async () => {
    const fetchFn = fakeFetch(() =>
      ok([series('srv-teste', 10), series('srv-teste2', 1, 'GB', '2026-11-12T11:00:00Z'), series('srv-desconhecido', 5, 'GB')]),
    );
    await expect(reader(fetchFn).readBandwidthGb(H0, H1)).resolves.toEqual({
      status: 'ok', byKey: { api: null, static: 0 }, discardedSeries: 1,
    });
  });

  it('falha da Render vira unavailable; sem serviço mapeado não chama', async () => {
    await expect(reader(fakeFetch(() => ({ status: 500 }))).readBandwidthGb(H0, H1))
      .resolves.toEqual({ status: 'unavailable', reason: 'upstream' });
    const fetchFn = fakeFetch(() => ok([]));
    const onlyDb = new Map<InfraRenderKey, string>([['postgres', 'dpg-teste']]);
    await expect(reader(fetchFn, onlyDb).readBandwidthGb(H0, H1)).resolves.toEqual({ status: 'unavailable', reason: 'not_configured' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('converte unidades conhecidas e recusa as desconhecidas', () => {
    expect(bandwidthUnitToGb('bytes')).toBe(1e-9);
    expect(bandwidthUnitToGb('MB')).toBe(1e-3);
    expect(bandwidthUnitToGb('GiB')).toBeCloseTo(1.073741824);
    expect(bandwidthUnitToGb(undefined)).toBeNull();
    expect(bandwidthUnitToGb('requests')).toBeNull();
  });
});

describe('RenderInfraResourcePlanReader.readBuildMinutes', () => {
  const D0 = new Date('2026-11-12T00:00:00.000Z');
  const D1 = new Date('2026-11-13T00:00:00.000Z');
  const deploy = (id: string, startedAt?: string, finishedAt?: string) => ({
    deploy: { id, status: 'live', startedAt, finishedAt }, cursor: `c-${id}`,
  });

  it('soma finishedAt − startedAt em 2 páginas de cursor; sem deploy = 0; sem datas ignorado', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) =>
      i === 0 ? deploy('d0', '2026-11-12T10:00:00Z', '2026-11-12T10:03:00Z')
        : i === 1 ? deploy('d1', '2026-11-12T11:00:00Z')
          : deploy(`d${i}`, undefined, '2026-11-12T11:00:00Z'));
    const page2 = [deploy('d200', '2026-11-12T12:00:00Z', '2026-11-12T12:01:30Z')];
    const fetchFn = fakeFetch((url) => {
      if (url.pathname.endsWith('/srv-teste2/deploys')) return ok([]);
      return ok(url.searchParams.get('cursor') === 'c-d99' ? page2 : page1);
    });
    await expect(reader(fetchFn).readBuildMinutes(D0, D1)).resolves.toEqual({ status: 'ok', byKey: { api: 4.5, static: 0 } });
    const urls = fetchFn.mock.calls.map(([u]) => new URL(String(u)));
    expect(urls).toHaveLength(3);
    expect(urls[0]!.searchParams.get('limit')).toBe('100');
    expect(urls[0]!.searchParams.get('finishedAfter')).toBe(D0.toISOString());
    expect(urls[0]!.searchParams.get('finishedBefore')).toBe(D1.toISOString());
    expect(urls[0]!.searchParams.has('cursor')).toBe(false);
    expect(urls[1]!.searchParams.get('cursor')).toBe('c-d99');
  });

  it('429 em qualquer serviço devolve rate_limited', async () => {
    const fetchFn = fakeFetch(() => ({ status: 429, headers: { 'Ratelimit-Reset': '12' } }));
    await expect(reader(fetchFn).readBuildMinutes(D0, D1))
      .resolves.toEqual({ status: 'unavailable', reason: 'rate_limited', retryAfterSeconds: 12 });
  });
});

describe('divergência com o cadastro (config_drift)', () => {
  const reading = { plan: 'basic_1gb', instances: 2, diskGb: 15 };
  it('aponta plano, instâncias e disco diferentes', () => {
    expect(infraResourceDriftFields(reading, { plan: 'standard', instances: 1, diskGb: 10 })).toEqual(['plan', 'instances', 'diskGb']);
  });
  it('igual (plano sem diferença de grafia) ou desconhecido não diverge', () => {
    expect(infraResourceDriftFields(reading, { plan: 'Basic-1GB', instances: 2, diskGb: 15 })).toEqual([]);
    expect(infraResourceDriftFields({ plan: null, instances: null, diskGb: null }, { plan: 'x', instances: 1, diskGb: 1 })).toEqual([]);
    expect(infraResourceDriftFields(reading, {})).toEqual([]);
  });
});

describe('createInfraResourcePlanReader', () => {
  it('sem chave ou sem recurso: não configurado e nenhuma chamada', async () => {
    const fetchFn = fakeFetch(() => ok({}));
    const noKey = createInfraResourcePlanReader({ apiKey: undefined, resources: RES }, { fetchFn });
    const noRes = createInfraResourcePlanReader({ apiKey: KEY, resources: new Map() }, { fetchFn });
    for (const r of [noKey, noRes]) {
      expect(r).toBeInstanceOf(NotConfiguredInfraResourcePlanReader);
      expect(r.configuredKeys()).toEqual([]);
      await expect(r.readResource('api')).resolves.toEqual({ status: 'unavailable', reason: 'not_configured' });
      await expect(r.readBandwidthGb(H0, H1)).resolves.toEqual({ status: 'unavailable', reason: 'not_configured' });
      await expect(r.readBuildMinutes(H0, H1)).resolves.toEqual({ status: 'unavailable', reason: 'not_configured' });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('com chave e recursos: Render com as chaves lógicas', () => {
    const r = createInfraResourcePlanReader({ apiKey: KEY, resources: RES });
    expect(r).toBeInstanceOf(RenderInfraResourcePlanReader);
    expect(r.configuredKeys()).toEqual(['api', 'static', 'postgres', 'redis']);
  });
});
