import { describe, expect, it, vi } from 'vitest';
import { BCB_PTAX_URL, BcbPtaxFxRateSource, bcbPtaxUrl, parsePtaxResponse } from './BcbPtaxFxRateSource';

const now = () => new Date('2026-11-12T19:00:00.000Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fake = (res: () => Promise<Response>) => vi.fn(res) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const row = (venda: unknown) => ({ value: [{ cotacaoCompra: 5.56, cotacaoVenda: venda, dataHoraCotacao: '2026-11-11 13:02:30.354667' }] });

describe('BcbPtaxFxRateSource', () => {
  it('janela de 7 dias no dia de Brasília, ordem desc, top 1', () => {
    expect(bcbPtaxUrl(now())).toBe(
      `${BCB_PTAX_URL}?@i='11-06-2026'&@f='11-12-2026'&$format=json&$orderby=dataHoraCotacao%20desc&$top=1`,
    );
    // 01:00 UTC ainda é o dia anterior em Brasília
    expect(bcbPtaxUrl(new Date('2026-11-13T01:00:00Z'))).toContain("@f='11-12-2026'");
  });

  it('1 linha → cotacaoVenda e data do boletim; com timeout', async () => {
    const fetchFn = fake(async () => json(row(5.5606)));
    expect(await new BcbPtaxFxRateSource({ fetchFn, now }).fetchLatest()).toEqual({
      rate: 5.5606, referenceDate: '2026-11-11', source: 'ptax',
    });
    const init = fetchFn.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('value vazio, valor 0/NaN/25/texto e sem data → null', () => {
    expect(parsePtaxResponse({ value: [] })).toBeNull();
    for (const v of [0, NaN, 25, '5.5', null]) expect(parsePtaxResponse(row(v))).toBeNull();
    expect(parsePtaxResponse({ value: [{ cotacaoVenda: 5.5 }] })).toBeNull();
    expect(parsePtaxResponse(null)).toBeNull();
  });

  it('HTTP de erro, rede e JSON inválido → null', async () => {
    for (const r of [async () => json({}, 500), async () => { throw new TypeError('fetch failed'); }, async () => new Response('<html>')]) {
      expect(await new BcbPtaxFxRateSource({ fetchFn: fake(r), now }).fetchLatest()).toBeNull();
    }
  });

  it('timeout aborta e devolve null', async () => {
    const fetchFn = vi.fn((_: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    expect(await new BcbPtaxFxRateSource({ fetchFn, now, timeoutMs: 10 }).fetchLatest()).toBeNull();
  });
});
