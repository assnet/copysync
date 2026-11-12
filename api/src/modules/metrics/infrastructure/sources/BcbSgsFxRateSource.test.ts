import { describe, expect, it, vi } from 'vitest';
import { BCB_SGS_URL, BcbSgsFxRateSource, parseSgsResponse } from './BcbSgsFxRateSource';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fake = (impl: (url: unknown, init?: RequestInit) => Promise<Response>) => vi.fn(impl) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('BcbSgsFxRateSource', () => {
  it('valor em texto e data DD/MM/AAAA; URL fixa com timeout', async () => {
    const fetchFn = fake(async () => json([{ data: '11/11/2026', valor: '5.5606' }]));
    expect(await new BcbSgsFxRateSource({ fetchFn }).fetchLatest()).toEqual({ rate: 5.5606, referenceDate: '2026-11-11', source: 'sgs' });
    const [url, init] = fetchFn.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(BCB_SGS_URL);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('vazio, valor 0/NaN/25/não numérico e data inválida → null', () => {
    expect(parseSgsResponse([])).toBeNull();
    expect(parseSgsResponse({})).toBeNull();
    for (const valor of ['0', 'NaN', '25', '5,56', '', 5.56]) expect(parseSgsResponse([{ data: '11/11/2026', valor }])).toBeNull();
    expect(parseSgsResponse([{ data: '2026-11-11', valor: '5.56' }])).toBeNull();
  });

  it('erro HTTP, rede e timeout → null', async () => {
    expect(await new BcbSgsFxRateSource({ fetchFn: fake(async () => json([], 503)) }).fetchLatest()).toBeNull();
    expect(await new BcbSgsFxRateSource({ fetchFn: fake(async () => { throw new TypeError('x'); }) }).fetchLatest()).toBeNull();
    const hang = fake((_, init) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))));
    expect(await new BcbSgsFxRateSource({ fetchFn: hang, timeoutMs: 10 }).fetchLatest()).toBeNull();
  });
});
