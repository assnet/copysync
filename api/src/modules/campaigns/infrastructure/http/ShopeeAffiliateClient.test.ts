import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShopeeAffiliateClient, mapShopeeNode, parsePriceCents } from './ShopeeAffiliateClient';

const CRED = { appId: '123456', secret: 'segredo-xyz' };
const REF = { shopId: '111', itemId: '222' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(impl: (...a: unknown[]) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ShopeeAffiliateClient', () => {
  it('assina appId+ts+corpo exato+secret e envia o mesmo corpo', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_500 });
    const fn = stubFetch(async () => json({ data: { productOfferV2: { nodes: [] } } }));
    await new ShopeeAffiliateClient().getProduct(CRED, REF);

    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://open-api.affiliate.shopee.com.br/graphql');
    const body = init.body as string;
    expect(JSON.parse(body).query).toContain('productOfferV2(shopId: 111, itemId: 222, limit: 1)');
    const sig = createHash('sha256').update(`123456${1_700_000_000}${body}segredo-xyz`).digest('hex');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`SHA256 Credential=123456, Timestamp=1700000000, Signature=${sig}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(body).not.toContain('segredo');
  });

  it('mapeia produto com preço string e desconto', async () => {
    stubFetch(async () =>
      json({
        data: {
          productOfferV2: {
            nodes: [{ productName: 'Fone', imageUrl: 'https://cf.shopee.com.br/x', priceMin: '90.00', priceDiscountRate: 10, offerLink: 'https://s.shopee.com.br/a' }],
          },
        },
      }),
    );
    expect(await new ShopeeAffiliateClient().getProduct(CRED, REF)).toEqual({
      title: 'Fone',
      imageUrl: 'https://cf.shopee.com.br/x',
      priceCents: 9000,
      originalPriceCents: 10000,
      offerLink: 'https://s.shopee.com.br/a',
    });
  });

  it('nodes vazio → null', async () => {
    stubFetch(async () => json({ data: { productOfferV2: { nodes: [] } } }));
    expect(await new ShopeeAffiliateClient().getProduct(CRED, REF)).toBeNull();
  });

  it('recusa ids não numéricos sem chamar a rede', async () => {
    const fn = stubFetch(async () => json({}));
    await expect(new ShopeeAffiliateClient().getProduct(CRED, { shopId: '1) {x}', itemId: '2' })).rejects.toMatchObject({ code: 'OFFER_URL_UNSUPPORTED' });
    expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    [{ errors: [{ extensions: { code: 10035 } }] }, 200, 'AFFILIATE_API_ACCESS_DENIED'],
    [{ errors: [{ code: '10020' }] }, 200, 'AFFILIATE_CREDENTIAL_REJECTED'],
    [{ errors: [{ extensions: { code: 10032 } }] }, 200, 'AFFILIATE_CREDENTIAL_REJECTED'],
    [{ errors: [{ extensions: { code: 10030 } }] }, 200, 'AFFILIATE_API_RATE_LIMITED'],
    [{}, 429, 'AFFILIATE_API_RATE_LIMITED'],
    [{}, 502, 'AFFILIATE_API_UNAVAILABLE'],
    [{ errors: [{ extensions: { code: 99999 } }] }, 200, 'AFFILIATE_API_UNAVAILABLE'],
  ])('mapeia erro %j (HTTP %i) → %s', async (body, status, code) => {
    stubFetch(async () => json(body, status));
    await expect(new ShopeeAffiliateClient().getProduct(CRED, REF)).rejects.toMatchObject({ code });
  });

  it('timeout/rede e corpo não-JSON → indisponível', async () => {
    stubFetch(async () => {
      throw new DOMException('timeout', 'TimeoutError');
    });
    await expect(new ShopeeAffiliateClient().getProduct(CRED, REF)).rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
    stubFetch(async () => new Response('<html>', { status: 200 }));
    await expect(new ShopeeAffiliateClient().getProduct(CRED, REF)).rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
  });

  it('generateShortLink escapa originUrl e subIds como literais', async () => {
    const fn = stubFetch(async () => json({ data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/z' } } }));
    const link = await new ShopeeAffiliateClient().generateShortLink(CRED, 'https://shopee.com.br/p?a="b"', ['grupo1']);
    expect(link).toBe('https://s.shopee.com.br/z');
    const query = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string).query as string;
    expect(query).toContain('originUrl: "https://shopee.com.br/p?a=\\"b\\""');
    expect(query).toContain('subIds: ["grupo1"]');
  });

  it('generateShortLink sem shortLink → indisponível', async () => {
    stubFetch(async () => json({ data: { generateShortLink: null } }));
    await expect(new ShopeeAffiliateClient().generateShortLink(CRED, 'https://shopee.com.br/p')).rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
  });
});

describe('parsePriceCents / mapShopeeNode', () => {
  it('aceita string, número e rejeita lixo', () => {
    expect(parsePriceCents('129.9')).toBe(12990);
    expect(parsePriceCents(19.99)).toBe(1999);
    expect(parsePriceCents('abc')).toBeNull();
    expect(parsePriceCents(undefined)).toBeNull();
    expect(parsePriceCents(-1)).toBeNull();
  });

  it('campos ausentes viram null; sem título → null', () => {
    expect(mapShopeeNode({ productName: 'X' })).toEqual({ title: 'X', imageUrl: null, priceCents: null, originalPriceCents: null, offerLink: null });
    expect(mapShopeeNode({ productName: 'X', priceMin: '10', priceDiscountRate: 100 })?.originalPriceCents).toBeNull();
    expect(mapShopeeNode({})).toBeNull();
  });
});
