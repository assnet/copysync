import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.hoisted(() => vi.fn());
vi.mock('../../../../shared/logger/logger', () => ({
  logger: { child: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { SheinCatalogClient, mapSheinCatalogItem, parseSheinEndTime } from './SheinCatalogClient';
import { USER_AGENT } from './HttpShortLinkExpander';

const SESSION = { token: 'tok-secreto-123', memberId: 'member-987' };
const BASE = 'https://m.shein.com/br/affiliate/api/seller/activity';
const ITEM = {
  goodsId: 533885353,
  skcCode: 'sz2407221234567890',
  goodsName: 'Vestido  Midi   Floral',
  mainImage: 'http://img.ltwebstatic.com/v4/j/spmp/2026/07/22/a5/x.jpg',
  salesPrice: '59.90',
  retailPrice: '99.90',
  discount: 40,
  percentPlatformCommission: '15%',
  commission: '8.99',
  percentPlatformCommissionOfOld: '8%',
  commissionOfOld: '4.79',
  extraCommission: '1.50',
  commissionAddExtra: '10.49',
  spuSales: '300+',
  commentNum: '1000+',
  commentRankAverage: '4.85',
  rank: 3,
  categoryId: 4436,
  activityId: 20,
  sellGoodsEndTime: '2026-11-30 23:59:59',
  storeCode: 'S123',
  oneLink: null,
};
const page = (goodsList: unknown, extra: Record<string, unknown> = {}) => ({
  code: '0',
  msg: 'OK',
  info: { goodsList, total: 1000, hasNextPage: true, pageNum: 1, pageSize: 10, ...extra },
});
const QUERY = { page: 1, did: 4946855, category: { categoryId: '1864', name: 'Beauty & Health' }, sort: 'BEST_SELLING' as const };
const ALL_QUERY = { page: 1, did: 4946855, category: null, sort: 'RECOMMENDED' as const };
const MAT_ALL = { name: 'All', cateId: null, did: 4946855, contextParam: { filterCateId: null, cateId: null } };
const MAT_BEAUTY = { name: 'Beauty & Health', cateId: '1864', did: 4946855, contextParam: { filterCateId: '1864', cateId: '1864' } };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function stubFetch(impl: (...a: unknown[]) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}
const call = (fn: ReturnType<typeof stubFetch>, i = 0) => fn.mock.calls[i] as [string, RequestInit];

const client = new SheinCatalogClient();
const list = () => client.list(SESSION, QUERY);

beforeEach(() => warn.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe('SheinCatalogClient.list', () => {
  it('request fixo: URL, headers exatos (sem anti-bot) e corpo da sonda com categoria', async () => {
    const fn = stubFetch(async () => json(page([ITEM])));
    await list();
    const [url, init] = call(fn);
    expect(url).toBe(`${BASE}/goods/list`);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({
      token: 'tok-secreto-123',
      siteuid: 'mbr',
      language: 'pt-br',
      mi: 'member-987',
      channel: '1',
      'content-type': 'application/json',
      'User-Agent': USER_AGENT,
    });
    expect(JSON.parse(init.body as string)).toEqual({
      pageNum: 1,
      pageSize: 20,
      sort: 12,
      materialInfoInfo: MAT_BEAUTY,
      randomShow: false,
    });
  });

  it('sem categoria → corpo exato da sonda ("All", cateId null)', async () => {
    const fn = stubFetch(async () => json(page([])));
    await client.list(SESSION, ALL_QUERY);
    expect(JSON.parse(call(fn)[1].body as string)).toEqual({
      pageNum: 1, pageSize: 20, sort: 0, materialInfoInfo: MAT_ALL, randomShow: false,
    });
  });

  it('mapeamento completo do item', async () => {
    stubFetch(async () => json(page([ITEM])));
    expect(await list()).toEqual({
      items: [
        {
          provider: 'SHEIN',
          productId: '533885353',
          skc: 'sz2407221234567890',
          activityId: '20',
          title: 'Vestido Midi Floral',
          imageUrl: 'https://img.ltwebstatic.com/v4/j/spmp/2026/07/22/a5/x.jpg',
          priceCents: 5990,
          retailPriceCents: 9990,
          discountPct: 40,
          commissionNewPct: 15,
          commissionNewCents: 899,
          commissionReturningPct: 8,
          commissionReturningCents: 479,
          extraCommissionCents: 150,
          hasSecondaryCommission: true,
          extraFlag: true,
          commissionEstimated: false,
          sales: 300,
          reviews: 1000,
          rating: 4.85,
          rank: 3,
          categoryId: '4436',
          campaignEndsAt: new Date('2026-12-01T02:59:59.000Z'),
        },
      ],
      hasNextPage: true,
      total: 1000,
    });
  });

  it('item sem goodsId válido é descartado; demais seguem', async () => {
    stubFetch(async () =>
      json(page([{ ...ITEM, goodsId: null }, { ...ITEM, goodsId: '12a' }, 'lixo', { ...ITEM, goodsId: '1'.repeat(13) }, ITEM])),
    );
    const r = await list();
    expect(r.items.map((i) => i.productId)).toEqual(['533885353']);
  });

  it.each([
    'https://evil.example.com/x.jpg',
    'https://img.ltwebstatic.com.evil.io/x.jpg',
    'https://user:x@img.ltwebstatic.com/x.jpg',
    'https://img.ltwebstatic.com:8443/x.jpg',
    'javascript:alert(1)',
    '',
  ])('imagem fora do host (%s) → null', async (mainImage) => {
    stubFetch(async () => json(page([{ ...ITEM, mainImage }])));
    expect((await list()).items[0]!.imageUrl).toBeNull();
  });

  it('campos ausentes → padrões seguros; desconto calculado dos preços', async () => {
    stubFetch(async () => json(page([{ goodsId: '1234', salesPrice: 30, retailPrice: 60 }])));
    expect((await list()).items[0]).toMatchObject({
      title: null, imageUrl: null, priceCents: 3000, retailPriceCents: 6000, discountPct: 50, commissionNewCents: 0,
      commissionNewPct: 0, extraCommissionCents: 0, sales: 0, reviews: 0, rating: null, rank: null, campaignEndsAt: null,
    });
  });

  it('lista vazia é legítima', async () => {
    stubFetch(async () => json(page([], { hasNextPage: false, total: 0 })));
    expect(await list()).toEqual({ items: [], hasNextPage: false, total: 0 });
  });

  it('goodsList null com code 0 (header faltando) → indisponível, não vazio', async () => {
    stubFetch(async () => json(page(null)));
    await expect(list()).rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
  });

  it.each([
    ['lista na raiz, sem info', { code: '0', goodsList: [ITEM], total: 1, hasNextPage: false }],
    ['total ausente', page([ITEM], { total: undefined })],
    ['total string', page([ITEM], { total: '1000' })],
    ['hasNextPage ausente', page([ITEM], { hasNextPage: undefined })],
    ['info array', { code: '0', info: [ITEM] }],
  ])('formato fora do observado (%s) → indisponível', async (_n, body) => {
    stubFetch(async () => json(body));
    await expect(list()).rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
  });

  it.each([401, 403])('HTTP %i com code 100105 → credencial rejeitada', async (status) => {
    stubFetch(async () => json({ code: '100105' }, status));
    await expect(list()).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED' });
  });

  it('HTTP 401 sem corpo → credencial rejeitada', async () => {
    stubFetch(async () => new Response(null, { status: 401 }));
    await expect(list()).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED' });
  });

  it('code 100105 em 200 → credencial rejeitada', async () => {
    stubFetch(async () => json({ code: '100105', msg: 'not login' }));
    await expect(list()).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED' });
  });

  it.each([
    ['403 HTML de WAF', async () => new Response('<html>Access denied</html>', { status: 403 })],
    ['403 outro code', async () => json({ code: '403001' }, 403)],
    ['302', async () => new Response(null, { status: 302, headers: { location: 'https://m.shein.com/risk/challenge' } })],
    ['500', async () => json({}, 500)],
    ['timeout', async () => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' }))],
    ['JSON inválido', async () => new Response('<html>nope', { status: 200 })],
    ['JSON não objeto', async () => json([1, 2])],
    ['corpo > 256 KiB', async () => new Response('x'.repeat(300 * 1024), { status: 200 })],
    ['code inesperado', async () => json({ code: '200401' })],
  ])('%s → indisponível', async (_n, impl) => {
    stubFetch(impl as () => Promise<Response>);
    await expect(list()).rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
  });

  it.each([
    { page: 0 },
    { page: 1.5 },
    { did: '4946855' },
    { did: 0 },
    { did: 1.5 },
    { category: { categoryId: 'abc', name: 'X' } },
    { category: { categoryId: 1864, name: 'X' } },
    { category: { categoryId: '1864', name: '' } },
    { category: { categoryId: '1864', name: 'a\u0000b' } },
    { category: { categoryId: '1864', name: 'a'.repeat(81) } },
    { sort: 'X' },
  ])('query inválida (%o) → recusada sem rede', async (patch) => {
    const fn = stubFetch(async () => json(page([])));
    await expect(client.list(SESSION, { ...QUERY, ...patch } as never)).rejects.toMatchObject({ code: 'OFFER_INVALID_INPUT' });
    expect(fn).not.toHaveBeenCalled();
  });

});

describe('SheinCatalogClient.search', () => {
  it('URL de busca e corpo exato da sonda (sem randomShow)', async () => {
    const fn = stubFetch(async () => json(page([ITEM])));
    await client.search(SESSION, { ...ALL_QUERY, keyword: '  vestido  ' });
    const [url, init] = call(fn);
    expect(url).toBe(`${BASE}/goods/search`);
    expect(JSON.parse(init.body as string)).toEqual({
      searchKey: 'vestido', pageNum: 1, pageSize: 20, materialInfoInfo: MAT_ALL, sort: 0,
    });
  });

  it('busca com categoria espelha cateId no contextParam', async () => {
    const fn = stubFetch(async () => json(page([])));
    await client.search(SESSION, { ...QUERY, keyword: 'vestido' });
    expect(JSON.parse(call(fn)[1].body as string)).toEqual({
      searchKey: 'vestido', pageNum: 1, pageSize: 20, materialInfoInfo: MAT_BEAUTY, sort: 12,
    });
  });

  it.each(['', '   ', 'a'.repeat(61), 'vest\u0000ido', 'linha\nnova', 'x\u2028y'])(
    'keyword inválida (%j) → recusada antes da rede',
    async (keyword) => {
      const fn = stubFetch(async () => json(page([])));
      await expect(client.search(SESSION, { ...QUERY, keyword })).rejects.toMatchObject({ code: 'OFFER_INVALID_INPUT' });
      expect(fn).not.toHaveBeenCalled();
    },
  );

  it('keyword com 60 caracteres passa', async () => {
    stubFetch(async () => json(page([])));
    await expect(client.search(SESSION, { ...QUERY, keyword: 'a'.repeat(60) })).resolves.toMatchObject({ items: [] });
  });
});

describe('SheinCatalogClient.listCategories / resolveCommissionBand', () => {
  it('categorias: {} no corpo; materialInfoList com "All" primeiro; itens inválidos descartados', async () => {
    const fn = stubFetch(async () =>
      json({
        code: '0',
        info: {
          sortTypeList: [0, 7, 9, 10, 11, 12],
          materialInfoList: [
            MAT_ALL,
            MAT_BEAUTY,
            { name: 'Kids', cateId: '2031', did: 4946999, contextParam: { filterCateId: '2031', cateId: '2031' } },
            { name: '', cateId: '1', did: 1 },
            { name: 'Ruim', cateId: 'x', did: 1 },
            { name: 'Did string', cateId: '3224', did: '4946855' },
          ],
        },
      }),
    );
    expect(await client.listCategories(SESSION)).toEqual([
      { categoryId: null, name: 'All', did: 4946855 },
      { categoryId: '1864', name: 'Beauty & Health', did: 4946855 },
      { categoryId: '2031', name: 'Kids', did: 4946999 },
    ]);
    const [url, init] = call(fn);
    expect(url).toBe(`${BASE}/category`);
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it.each([
    ['sem materialInfoList', { code: '0', info: { sortTypeList: [0] } }],
    ['lista em outro campo', { code: '0', info: { cateList: [MAT_ALL] } }],
    ['info array', { code: '0', info: [MAT_ALL] }],
  ])('categorias fora do formato (%s) → indisponível', async (_n, body) => {
    stubFetch(async () => json(body));
    await expect(client.listCategories(SESSION)).rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
  });

  it.each([
    ['BELOW_5', 1],
    ['FROM_5_TO_10', 2],
    ['FROM_10_TO_15', 3],
    ['ABOVE_15', 4],
    ['ANY', 5],
  ] as const)('faixa %s → commRate %i → did', async (band, commRate) => {
    const fn = stubFetch(async () =>
      json({ code: '0', info: { materialInfoList: [{ ...MAT_ALL, did: 5105730 + commRate }] } }),
    );
    expect(await client.resolveCommissionBand(SESSION, band)).toBe(5105730 + commRate);
    const [url, init] = call(fn);
    expect(url).toBe(`${BASE}/categoryRate`);
    expect(JSON.parse(init.body as string)).toEqual({ commRate });
  });

  it('faixa fora do enum → recusada sem rede', async () => {
    const fn = stubFetch(async () => json({ code: '0', info: { materialInfoList: [MAT_ALL] } }));
    await expect(client.resolveCommissionBand(SESSION, 'X' as never)).rejects.toMatchObject({ code: 'OFFER_INVALID_INPUT' });
    expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    ['info.did (formato não observado)', { code: '0', info: { did: 5105735 } }],
    ['lista vazia', { code: '0', info: { materialInfoList: [] } }],
    ['did string', { code: '0', info: { materialInfoList: [{ ...MAT_ALL, did: '5105735' }] } }],
  ])('faixa fora do formato (%s) → indisponível', async (_n, body) => {
    stubFetch(async () => json(body));
    await expect(client.resolveCommissionBand(SESSION, 'ABOVE_15')).rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
  });
});

describe('segredos', () => {
  it('token, memberId e palavra-chave nunca em log nem em mensagem de erro', async () => {
    const errors: unknown[] = [];
    for (const impl of [
      async () => json({ code: '999' }),
      async () => json({ code: '100105' }),
      async () => json({}, 403),
      async () => json({}, 500),
      async () => new Response('bad', { status: 200 }),
      async () => json(page(null)),
      async () => json(page([{ goodsId: 'x' }])),
      async () => Promise.reject(new Error('tok-secreto-123 member-987')),
    ]) {
      stubFetch(impl as () => Promise<Response>);
      await client.list(SESSION, QUERY).catch((e) => errors.push(e));
      await client.search(SESSION, { ...QUERY, keyword: 'palavra-secreta' }).catch((e) => errors.push(e));
    }
    expect(warn).toHaveBeenCalled();
    expect(errors.length).toBeGreaterThan(0);
    const dump =
      JSON.stringify(warn.mock.calls) +
      errors.map((e) => `${(e as Error).message} ${JSON.stringify(e)} ${(e as Error).stack ?? ''}`).join('\n');
    for (const s of ['tok-secreto-123', 'member-987', 'palavra-secreta', 'shein.com', '4946855']) expect(dump).not.toContain(s);
  });
});

describe('parseSheinEndTime / mapSheinCatalogItem', () => {
  it.each([
    ['2026-11-30 23:59:59', '2026-12-01T02:59:59.000Z'],
    ['2026-11-30 23:59', '2026-12-01T02:59:00.000Z'],
    ['2026-11-30T10:00:00Z', '2026-11-30T10:00:00.000Z'],
    [1764557999, '2025-12-01T02:59:59.000Z'],
    [1764557999000, '2025-12-01T02:59:59.000Z'],
    ['1764557999', '2025-12-01T02:59:59.000Z'],
  ])('%s → %s', (raw, iso) => expect(parseSheinEndTime(raw)?.toISOString()).toBe(iso));

  it.each([null, '', 'amanhã', '2026-13-45 99:99', 0, {}])('%s → null', (raw) => expect(parseSheinEndTime(raw)).toBeNull());

  it('retail ≤ preço → null; nota fora de 0–5 → null; rank não inteiro → null', () => {
    expect(mapSheinCatalogItem({ ...ITEM, retailPrice: '59.90', commentRankAverage: '7', rank: 2.5 })).toMatchObject({
      retailPriceCents: null,
      rating: null,
      rank: null,
    });
  });
});
