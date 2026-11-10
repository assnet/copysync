import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.hoisted(() => vi.fn());
vi.mock('../../../../shared/logger/logger', () => ({
  logger: { child: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { SheinAffiliateClient } from './SheinAffiliateClient';
import { USER_AGENT } from './HttpShortLinkExpander';

const SESSION = { token: 'tok-secreto-123', memberId: 'member-987' };
const SHARE = 'https://onelink.shein.com/60/67s1w147gtfq?ismg_ol=7gr1l8MpNmD_01_KOC-C';
const OK = {
  code: '0',
  msg: 'OK',
  info: {
    goodsBasicInfo: {
      goodsId: 533885353,
      goodsName: 'Camisa Polo  Todos    Ajuste Regular    Bordado    Masculina',
      mainImage: 'http://img.ltwebstatic.com/v4/j/spmp/2026/07/22/a5/x_thumbnail_405x552.jpg',
      mainImageOfOriginImage: 'http://img.ltwebstatic.com/v4/j/spmp/2026/07/22/a5/x.jpg',
      discount: 40,
      retailPrice: 'R$50,00',
      salesPriceText: 'R$29,99',
      salesPrice: 29.99,
      oneLink: SHARE,
      activityId: 20,
      shareCode: '3D2H5WU',
    },
    shareLink: SHARE,
  },
};

type Info = { goodsBasicInfo: Record<string, unknown>; shareLink?: unknown };
function withInfo(patch: (i: Info) => void) {
  const body = structuredClone(OK) as { code: string; info: Info };
  patch(body.info);
  return body;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(impl: (...a: unknown[]) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

const client = new SheinAffiliateClient();
const get = (id = '533885353') => client.getProductShare(SESSION, id);

beforeEach(() => warn.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe('SheinAffiliateClient', () => {
  it('resposta real → share completo; request fixo', async () => {
    const fn = stubFetch(async () => json(OK));
    expect(await get()).toEqual({
      affiliateUrl: SHARE,
      title: 'Camisa Polo Todos Ajuste Regular Bordado Masculina',
      priceCents: 2999,
      originalPriceCents: 5000,
      imageUrl: 'https://img.ltwebstatic.com/v4/j/spmp/2026/07/22/a5/x.jpg',
    });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://m.shein.com/br/affiliate/api/goods/recommend/detailNew');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.headers).toEqual({
      token: 'tok-secreto-123',
      siteuid: 'mbr',
      'content-type': 'application/json',
      'User-Agent': USER_AGENT,
    });
    expect(JSON.parse(init.body as string)).toEqual({ language: 'pt-br', playId: 5, goodsId: 533885353, uid: 'member-987' });
  });

  it('preço em reais → centavos', async () => {
    stubFetch(async () => json(withInfo((i) => (i.goodsBasicInfo.salesPrice = 1234.5))));
    expect((await get())?.priceCents).toBe(123450);
  });

  it('retailPrice ≤ preço → originalPriceCents null', async () => {
    stubFetch(async () => json(withInfo((i) => (i.goodsBasicInfo.retailPrice = 'R$29,99'))));
    expect((await get())?.originalPriceCents).toBeNull();
  });

  it('sem imagem original usa mainImage forçada para https', async () => {
    stubFetch(async () => json(withInfo((i) => delete i.goodsBasicInfo.mainImageOfOriginImage)));
    expect((await get())?.imageUrl).toBe('https://img.ltwebstatic.com/v4/j/spmp/2026/07/22/a5/x_thumbnail_405x552.jpg');
  });

  it.each([401, 403])('HTTP %i com code 100105 → credencial rejeitada', async (status) => {
    stubFetch(async () => json({ code: '100105' }, status));
    await expect(get()).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED' });
  });

  it('HTTP 401 sem corpo → credencial rejeitada', async () => {
    stubFetch(async () => new Response(null, { status: 401 }));
    await expect(get()).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED' });
  });

  it.each([
    ['HTML de WAF', async () => new Response('<html>Access denied</html>', { status: 403 })],
    ['JSON com outro code', async () => json({ code: '403001' }, 403)],
  ])('HTTP 403 sem o código de sessão (%s) → indisponível, não pausa a loja', async (_n, impl) => {
    stubFetch(impl);
    await expect(get()).rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
  });

  it.each([
    'https://user:senha@onelink.shein.com/60/x',
    'https://onelink.shein.com:8443/60/x',
  ])('shareLink com credencial ou porta embutida → null (%s)', async (link) => {
    stubFetch(async () => json(withInfo((i) => (i.shareLink = link))));
    expect(await get()).toBeNull();
  });

  it('code 100105 em 200 → credencial rejeitada', async () => {
    stubFetch(async () => json({ code: '100105', msg: 'not login' }));
    await expect(get()).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED' });
  });

  it.each([
    ['302', async () => new Response(null, { status: 302, headers: { location: 'https://m.shein.com/risk/challenge' } })],
    ['500', async () => json({}, 500)],
    ['timeout', async () => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' }))],
    ['JSON inválido', async () => new Response('<html>nope', { status: 200 })],
    ['corpo > 256 KiB', async () => new Response('x'.repeat(300 * 1024), { status: 200 })],
  ])('%s → indisponível', async (_n, impl) => {
    stubFetch(impl as () => Promise<Response>);
    await expect(get()).rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
  });

  it('code desconhecido → null + warn com code', async () => {
    stubFetch(async () => json({ code: '200401', msg: 'x' }));
    expect(await get()).toBeNull();
    expect(warn).toHaveBeenCalledWith({ code: '200401' }, expect.any(String));
  });

  it('code 0 sem shareLink → null', async () => {
    stubFetch(async () => json(withInfo((i) => (i.shareLink = ''))));
    expect(await get()).toBeNull();
  });

  it.each(['https://evil.example.com/x', 'http://onelink.shein.com/60/x', 'https://onelink.shein.com.evil.io/x'])(
    'shareLink fora da regra (%s) → null',
    async (link) => {
      stubFetch(async () => json(withInfo((i) => (i.shareLink = link))));
      expect(await get()).toBeNull();
    },
  );

  it.each(['abc', '12a', '', '1'.repeat(21), '../1'])('goodsId inválido (%s) → null sem rede', async (id) => {
    const fn = stubFetch(async () => json(OK));
    expect(await get(id)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('log nunca contém token, memberId nem URL', async () => {
    for (const impl of [
      async () => json({ code: '999' }),
      async () => json({ code: '100105' }),
      async () => json({}, 403),
      async () => json({}, 500),
      async () => new Response('bad', { status: 200 }),
      async () => json(withInfo((i) => (i.shareLink = null))),
    ]) {
      stubFetch(impl);
      await get().catch(() => undefined);
    }
    expect(warn).toHaveBeenCalled();
    const dump = JSON.stringify(warn.mock.calls);
    for (const s of ['tok-secreto-123', 'member-987', 'onelink', 'shein.com', '533885353']) expect(dump).not.toContain(s);
  });
});
