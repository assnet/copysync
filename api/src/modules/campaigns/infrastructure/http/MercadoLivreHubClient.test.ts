import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AffiliateApiRateLimitedError,
  AffiliateApiUnavailableError,
  AffiliateCredentialRejectedError,
  OfferInvalidInputError,
} from '../../../../shared/errors/internal/OfferErrors';
import type { HuntSourceQuery, HuntSourceSession } from '../../domain/hunter/HuntProvider';
import fixture from './__fixtures__/mlHubSearch.json';
import { MercadoLivreHubClient } from './MercadoLivreHubClient';
import { mercadoLivreProductUrl, mercadoLivreSessionFrom } from '../hunter/providers/mercadoLivreHuntAdapter';

const SSID = 'sessao-secreta-ssid-123';
const CSRF = 'csrf-token-abc';
const SESSION: HuntSourceSession = { provider: 'MERCADO_LIVRE', cookies: { ssid: SSID } };
const SEARCH_URL = 'https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const bootstrapOk = () => new Response('<html></html>', { status: 200, headers: { 'set-cookie': `_csrf=${CSRF}; Path=/` } });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 1ª chamada = bootstrap do Link Builder; demais = hub. */
function stubFetch(...after: Array<() => Response | Promise<Response>>) {
  const queue = [bootstrapOk, ...after];
  const fn = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('fetch inesperado');
    return next();
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const hubCall = (fn: ReturnType<typeof stubFetch>) => fn.mock.calls[1] as unknown as [string, RequestInit];
const sentBody = (fn: ReturnType<typeof stubFetch>) => JSON.parse(hubCall(fn)[1].body as string) as unknown;

const q = (over: Partial<HuntSourceQuery> = {}): HuntSourceQuery => ({ page: 1, category: null, keyword: null, options: {}, ...over });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MercadoLivreHubClient.fetchPage — requisição', () => {
  it('URL, método, headers exatos e redirect manual', async () => {
    const fn = stubFetch(() => json(fixture));
    await new MercadoLivreHubClient().fetchPage(SESSION, q());
    const [url, init] = hubCall(fn);
    expect(url).toBe(SEARCH_URL);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.headers).toEqual({
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: 'https://www.mercadolivre.com.br',
      Referer: 'https://www.mercadolivre.com.br/afiliados/hub?is_affiliate=true',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: `ssid=${SSID}; _csrf=${CSRF}`,
      'X-Csrf-Token': CSRF,
    });
    const [bootUrl] = fn.mock.calls[0] as unknown as [URL];
    expect(String(bootUrl)).toBe('https://www.mercadolivre.com.br/afiliados/linkbuilder');
  });

  it.each<[string, Partial<HuntSourceQuery>, unknown]>([
    ['sem filtros', {}, { search: '', sort: 'relevance', filters: [], offset: 0 }],
    ['mais vendidos', { options: { bestSellersOnly: true } }, { search: '', sort: 'relevance', filters: [{ id: 'best_seller', value: true }], offset: 0 }],
    ['ganhos extras', { options: { extraEarningsOnly: true } }, { search: '', sort: 'relevance', filters: [{ id: 'extra_commission', value: true }], offset: 0 }],
    [
      'categoria',
      { category: { categoryId: 'MLB5726', name: 'Eletrodomésticos' } },
      { search: '', sort: 'relevance', filters: [{ id: 'category', value: 'MLB5726' }], offset: 0 },
    ],
    ['menor preço', { options: { sort: 'lowest_price' } }, { search: '', sort: 'lowest_price', filters: [], offset: 0 }],
    ['maior preço', { options: { sort: 'highest_price' } }, { search: '', sort: 'highest_price', filters: [], offset: 0 }],
    ['página 3 + busca', { page: 3, keyword: '  vestido ' }, { search: 'vestido', sort: 'relevance', filters: [], offset: 36 }],
    [
      'tudo junto',
      { page: 2, keyword: 'tenis', category: { categoryId: 'MLB1276', name: 'Esportes' }, options: { sort: 'lowest_price', bestSellersOnly: true, extraEarningsOnly: true } },
      {
        search: 'tenis',
        sort: 'lowest_price',
        filters: [{ id: 'best_seller', value: true }, { id: 'extra_commission', value: true }, { id: 'category', value: 'MLB1276' }],
        offset: 18,
      },
    ],
  ])('corpo exato: %s', async (_, over, expected) => {
    const fn = stubFetch(() => json(fixture));
    await new MercadoLivreHubClient().fetchPage(SESSION, q(over));
    expect(sentBody(fn)).toEqual(expected);
  });

  it.each<[string, Partial<HuntSourceQuery>]>([
    ['ordenação desconhecida', { options: { sort: 'best_selling' } }],
    ['página 0', { page: 0 }],
    ['categoria fora de MLB\\d+', { category: { categoryId: '123', name: 'x' } }],
    ['palavra longa', { keyword: 'x'.repeat(61) }],
    ['palavra com controle', { keyword: 'a\u0000b' }],
  ])('entrada inválida (%s) → OfferInvalidInputError sem chamar a fonte', async (_, over) => {
    const fn = stubFetch();
    await expect(new MercadoLivreHubClient().fetchPage(SESSION, q(over))).rejects.toBeInstanceOf(OfferInvalidInputError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('sessão de outra marca → OfferInvalidInputError', async () => {
    stubFetch();
    await expect(
      new MercadoLivreHubClient().fetchPage({ provider: 'SHEIN', token: 't', memberId: '1' }, q()),
    ).rejects.toBeInstanceOf(OfferInvalidInputError);
  });
});

describe('MercadoLivreHubClient.fetchPage — resposta', () => {
  it('mapeia a fixture; next_offset → hasNextPage', async () => {
    stubFetch(() => json(fixture));
    const page = await new MercadoLivreHubClient().fetchPage(SESSION, q({ category: { categoryId: 'MLB1051', name: 'Celulares' } }));
    expect(page.items).toHaveLength(4);
    expect(page.hasNextPage).toBe(true);
    expect(page.items[0]).toMatchObject({ provider: 'MERCADO_LIVRE', productId: 'MLB7806564298', categoryId: 'MLB1051' });
  });

  it('sem next_offset → última página', async () => {
    const body = clone(fixture) as Record<string, unknown>;
    delete body.next_offset;
    stubFetch(() => json(body));
    expect((await new MercadoLivreHubClient().fetchPage(SESSION, q())).hasNextPage).toBe(false);
  });

  it('cartão sem id válido é descartado', async () => {
    const body = clone(fixture);
    (body.polycard_client_model.polycards[1]!.metadata as Record<string, unknown>).id = 'MLBU1102059980';
    stubFetch(() => json(body));
    const page = await new MercadoLivreHubClient().fetchPage(SESSION, q());
    expect(page.items.map((c) => c.productId)).toEqual(['MLB7806564298', 'MLB7643858550', 'MLB7038595266']);
  });

  it('foto fora de *.mlstatic.com → imageUrl null', async () => {
    const body = clone(fixture);
    body.polycard_client_model.polycard_context.picture_template = 'https://cdn.evil.example/{id}.webp';
    stubFetch(() => json(body));
    const page = await new MercadoLivreHubClient().fetchPage(SESSION, q());
    expect(page.items.every((c) => c.imageUrl === null)).toBe(true);
  });

  it.each([
    ['sem polycard_client_model', { filters: [] }],
    ['polycards não é lista', { polycard_client_model: { polycards: {} } }],
    ['array na raiz', []],
  ])('formato inesperado (%s) → indisponível', async (_, body) => {
    stubFetch(() => json(body));
    await expect(new MercadoLivreHubClient().fetchPage(SESSION, q())).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
  });

  it('JSON ilegível → indisponível', async () => {
    stubFetch(() => new Response('<html>oops', { status: 200 }));
    await expect(new MercadoLivreHubClient().fetchPage(SESSION, q())).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
  });

  it('corpo > 256 KiB → indisponível', async () => {
    stubFetch(() => new Response(`{"x":"${'a'.repeat(300 * 1024)}"}`, { status: 200 }));
    await expect(new MercadoLivreHubClient().fetchPage(SESSION, q())).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
  });
});

describe('MercadoLivreHubClient — erros', () => {
  const run = () => new MercadoLivreHubClient().fetchPage(SESSION, q());

  it('401 → sessão recusada', async () => {
    stubFetch(() => json({}, 401));
    await expect(run()).rejects.toBeInstanceOf(AffiliateCredentialRejectedError);
  });

  it('redirect para login → sessão recusada', async () => {
    stubFetch(() => new Response(null, { status: 302, headers: { location: 'https://www.mercadolivre.com/jms/mlb/lgz/login' } }));
    await expect(run()).rejects.toBeInstanceOf(AffiliateCredentialRejectedError);
  });

  it('403 sem redirect (WAF) → indisponível, nunca recusada', async () => {
    stubFetch(() => new Response('blocked', { status: 403 }));
    await expect(run()).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
  });

  it('403 no bootstrap → indisponível (o createLink segue tratando como recusada)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('blocked', { status: 403 })));
    await expect(run()).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
  });

  it('bootstrap redirecionado para login → sessão recusada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://www.mercadolivre.com/jms/mlb/lgz/login' } })),
    );
    await expect(run()).rejects.toBeInstanceOf(AffiliateCredentialRejectedError);
  });

  it('redirect fora do hub que não é login (desafio no mesmo host) → indisponível, nunca recusada', async () => {
    stubFetch(() => new Response(null, { status: 302, headers: { location: '/gz/account-verification?go=x' } }));
    await expect(run()).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://www.mercadolivre.com.br/gz/challenge' } })),
    );
    await expect(run()).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
  });

  it('bootstrap com redirect sem https nunca é seguido (ssid em texto plano) → indisponível', async () => {
    const fn = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://www.mercadolivre.com.br/afiliados/hub' } }));
    vi.stubGlobal('fetch', fn);
    await expect(run()).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('429 → rate limit', async () => {
    stubFetch(() => json({}, 429));
    await expect(run()).rejects.toBeInstanceOf(AffiliateApiRateLimitedError);
  });

  it('500 e falha de rede → indisponível', async () => {
    stubFetch(() => json({}, 500));
    await expect(run()).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
    stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(run()).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
  });

  it('cookie e csrf nunca aparecem na mensagem de erro', async () => {
    for (const res of [() => json({}, 401), () => new Response('x', { status: 403 }), () => json({}, 429), () => json({ a: 1 })]) {
      stubFetch(res);
      const err = (await run().catch((e: unknown) => e)) as Error;
      expect(err).toBeInstanceOf(Error);
      const text = `${err.message} ${JSON.stringify(err)} ${String(err.stack)}`;
      expect(text).not.toContain(SSID);
      expect(text).not.toContain(CSRF);
    }
  });
});

describe('MercadoLivreHubClient.listCategories', () => {
  it('busca sem filtros no offset 0 e prefixa "Todas"', async () => {
    const fn = stubFetch(() => json(fixture));
    const cats = await new MercadoLivreHubClient().listCategories(SESSION);
    expect(sentBody(fn)).toEqual({ search: '', sort: 'relevance', filters: [], offset: 0 });
    expect(cats[0]).toEqual({ categoryId: null, name: 'Todas' });
    expect(cats).toHaveLength(26);
  });

  it('sem `filters` → indisponível', async () => {
    stubFetch(() => json({ polycard_client_model: { polycards: [] } }));
    await expect(new MercadoLivreHubClient().listCategories(SESSION)).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
  });
});

describe('MercadoLivreHubClient — bootstrap por sessão', () => {
  it('consultas seguidas da mesma sessão fazem 1 bootstrap só (amostra da IA: 7 requisições, não 12)', async () => {
    const fn = stubFetch(...Array.from({ length: 6 }, () => () => json(fixture)));
    const client = new MercadoLivreHubClient();
    await client.listCategories(SESSION);
    for (let i = 0; i < 5; i++) await client.fetchPage(SESSION, q());
    expect(fn).toHaveBeenCalledTimes(7);
    expect((fn.mock.calls as unknown as Array<[string]>).filter(([url]) => String(url).includes('/afiliados/linkbuilder'))).toHaveLength(1);
    const headers = (fn.mock.calls[6] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers['X-Csrf-Token']).toBe(CSRF);
  });

  it('outra sessão, bootstrap vencido ou resposta de erro refazem o bootstrap', async () => {
    let now = 0;
    const client = new MercadoLivreHubClient(() => now);
    const calls = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/afiliados/linkbuilder')).length;
    const fn = vi.fn(async (url: unknown) => (String(url).includes('/afiliados/linkbuilder') ? bootstrapOk() : json(fixture)));
    vi.stubGlobal('fetch', fn);
    await client.fetchPage(SESSION, q());
    await client.fetchPage({ provider: 'MERCADO_LIVRE', cookies: { ssid: SSID } }, q());
    expect(calls()).toBe(2);
    now = 61_000;
    await client.fetchPage(SESSION, q());
    expect(calls()).toBe(3);
    fn.mockImplementationOnce(async () => json({}, 403));
    await expect(client.fetchPage(SESSION, q())).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
    await client.fetchPage(SESSION, q());
    expect(calls()).toBe(4);
  });
});

describe('mercadoLivreHuntAdapter', () => {
  it('sessionFrom exige ssid', () => {
    expect(mercadoLivreSessionFrom({ session: { cookies: { ssid: 'x' } } })).toEqual({ provider: 'MERCADO_LIVRE', cookies: { ssid: 'x' } });
    expect(mercadoLivreSessionFrom({ session: { cookies: { AT: 'x' } } })).toBeNull();
    expect(mercadoLivreSessionFrom({ session: null })).toBeNull();
    expect(mercadoLivreSessionFrom(null)).toBeNull();
  });

  it('productUrl', () => {
    expect(mercadoLivreProductUrl('MLB7806564298')).toBe('https://produto.mercadolivre.com.br/MLB-7806564298');
    expect(mercadoLivreProductUrl('MLB-1')).toBeNull();
    expect(mercadoLivreProductUrl('https://x/MLB123456')).toBeNull();
  });
});
