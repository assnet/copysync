import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpShortLinkExpander, isShortLink } from './HttpShortLinkExpander';

function redirect(to: string, status = 302): Response {
  return new Response(null, { status, headers: { location: to } });
}

function stubFetch(impl: (url: URL, init: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

const SHORT = new URL('https://s.shopee.com.br/abc');
const PRODUCT = 'https://shopee.com.br/produto-i.111.222';

describe('HttpShortLinkExpander', () => {
  it('segue redirect relativo/absoluto até a URL final com HEAD manual', async () => {
    const fn = stubFetch(async (url) => {
      if (url.href === SHORT.href) return redirect('/x');
      if (url.pathname === '/x') return redirect(PRODUCT, 301);
      return new Response(null, { status: 200 });
    });
    const out = await new HttpShortLinkExpander().expand(SHORT);
    expect(out.href).toBe(PRODUCT);
    const init = fn.mock.calls[0][1];
    expect(init.method).toBe('HEAD');
    expect(init.redirect).toBe('manual');
    expect((init.headers as Record<string, string>)['User-Agent']).toContain('Chrome');
  });

  it('cai para GET em 405', async () => {
    const fn = stubFetch(async (_url, init) => (init.method === 'HEAD' ? new Response(null, { status: 405 }) : new Response(null, { status: 200 })));
    await new HttpShortLinkExpander().expand(SHORT);
    expect(fn.mock.calls.map((c) => c[1].method)).toEqual(['HEAD', 'GET']);
  });

  it('link.amazon: HEAD 404 → GET, salta por amzlinks.in até amazon.com.br', async () => {
    const final = 'https://www.amazon.com.br/dp/B07643MPGS?tag=x-20';
    const fn = stubFetch(async (url, init) => {
      if (url.hostname === 'link.amazon') return init.method === 'HEAD' ? new Response(null, { status: 404 }) : redirect('https://amzlinks.in/B00hBgkzm');
      if (url.hostname === 'amzlinks.in') return redirect(final);
      return new Response(null, { status: 200 });
    });
    const out = await new HttpShortLinkExpander().expand(new URL('https://link.amazon/B00hBgkzm'));
    expect(out.href).toBe(final);
    expect(fn.mock.calls.slice(0, 2).map((c) => c[1].method)).toEqual(['HEAD', 'GET']);
  });

  it('shoope.top (encurtador de terceiro) expande até shopee.com.br; redirect para fora da Shopee é recusado', async () => {
    const final = 'https://shopee.com.br/product/1441157744/25946709329?utm_source=an_1&utm_content=dvlinks';
    stubFetch(async (url) => (url.hostname === 'shoope.top' ? redirect(final) : new Response(null, { status: 200 })));
    expect((await new HttpShortLinkExpander().expand(new URL('https://shoope.top/_c8d09838ba'))).href).toBe(final);
    const fn = stubFetch(async (url) => (url.hostname === 'shoope.top' ? redirect('https://evil.example.com/x') : new Response(null)));
    await expect(new HttpShortLinkExpander().expand(new URL('https://shoope.top/_y'))).rejects.toMatchObject({ code: 'OFFER_URL_UNSUPPORTED' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('redirect para host fora da allowlist é recusado sem ser buscado', async () => {
    const fn = stubFetch(async (url) => (url.href === SHORT.href ? redirect('https://evil.example.com/p') : new Response(null, { status: 200 })));
    await expect(new HttpShortLinkExpander().expand(SHORT)).rejects.toMatchObject({ code: 'OFFER_URL_UNSUPPORTED' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls.some((c) => c[0].hostname === 'evil.example.com')).toBe(false);
  });

  it('recusa redirect para http', async () => {
    stubFetch(async () => redirect('http://shopee.com.br/p'));
    await expect(new HttpShortLinkExpander().expand(SHORT)).rejects.toMatchObject({ code: 'OFFER_URL_UNSUPPORTED' });
  });

  it('limite de 5 saltos', async () => {
    let n = 0;
    const fn = stubFetch(async () => redirect(`https://s.shopee.com.br/h${n++}`));
    await expect(new HttpShortLinkExpander().expand(SHORT)).rejects.toMatchObject({ code: 'OFFER_URL_UNSUPPORTED' });
    expect(fn).toHaveBeenCalledTimes(6);
  });

  it('URL de produto e host fora da allowlist não tocam a rede', async () => {
    const fn = stubFetch(async () => new Response(null));
    const out = await new HttpShortLinkExpander().expand(new URL(PRODUCT));
    expect(out.href).toBe(PRODUCT);
    await expect(new HttpShortLinkExpander().expand(new URL('https://evil.example.com/x'))).rejects.toMatchObject({ code: 'OFFER_URL_UNSUPPORTED' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('isShortLink: encurtadores das três lojas, inclusive br.shp.ee; produto não é curto', () => {
    for (const h of ['https://br.shp.ee/8pq7D1kb', 'https://shope.ee/x', 'https://s.shopee.com.br/x', 'https://meli.la/x', 'https://amzn.to/x', 'https://a.co/d/x', 'https://link.amazon/x', 'https://amzlinks.in/x', 'https://shoope.top/_x', 'https://mercadolivre.com/sec/x', 'https://click1.mercadolivre.com.br/mclics/clicks/external/MLB/count?x=1']) {
      expect(isShortLink(new URL(h))).toBe(true);
    }
    expect(isShortLink(new URL(PRODUCT))).toBe(false);
    expect(isShortLink(new URL('https://www.mercadolivre.com.br/social/etq?ref=x'))).toBe(false);
  });

  it('falha de rede → indisponível', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(new HttpShortLinkExpander().expand(SHORT)).rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
  });

  describe('onelink.shein.com', () => {
    const ONELINK = new URL('https://onelink.shein.com/60/67s1itltjnsh');
    const PRODUCT_URL =
      'https://br.shein.com/Men-Polo-Shirts-p-533885353-cat-1979.html?onelink=60/67s1itltjnsh&requestId=olw-67s1oaww2gjj&ismg_ol=J8tt4PR8Y4d_01_KOC-C&campaign_id=20&url_from=affiliate_koc_4320454940';
    const FIXTURE =
      '<html><body><input id="url" value="https://br.shein.com/Men-Polo-Shirts-p-533885353-cat-1979.html?onelink=60/67s1itltjnsh&amp;requestId=olw-67s1oaww2gjj&amp;ismg_ol=J8tt4PR8Y4d_01_KOC-C&amp;campaign_id=20&amp;url_from=affiliate_koc_4320454940" style="display: none"/></body></html>';
    const page = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });

    it('GET (nunca HEAD), lê o input, desfaz &amp; e não busca a página do produto', async () => {
      const fn = stubFetch(async () => page(FIXTURE));
      const out = await new HttpShortLinkExpander().expand(ONELINK);
      expect(out.href).toBe(PRODUCT_URL);
      expect(out.searchParams.get('url_from')).toBe('affiliate_koc_4320454940');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls[0][1].method).toBe('GET');
      expect(fn.mock.calls[0][1].redirect).toBe('manual');
    });

    it('3xx para página Shein: devolve o destino sem buscá-lo', async () => {
      const fn = stubFetch(async () => redirect(PRODUCT_URL));
      const out = await new HttpShortLinkExpander().expand(ONELINK);
      expect(out.href).toBe(PRODUCT_URL);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('aspas simples, outra ordem de atributos e entidades', async () => {
      stubFetch(async () => page(`<input type='hidden' data-id='x' value='https://br.shein.com/p-1.html?a=1&amp;b=&quot;2&quot;&#39;' id='url'>`));
      const out = await new HttpShortLinkExpander().expand(ONELINK);
      expect(out.searchParams.get('b')).toBe(`"2"'`);
      expect(out.searchParams.get('a')).toBe('1');
    });

    it('destino fora da allowlist ou inválido é recusado', async () => {
      for (const v of ['https://evil.example.com/p', 'http://br.shein.com/p-1.html', 'nao-url']) {
        stubFetch(async () => page(`<input id="url" value="${v}">`));
        await expect(new HttpShortLinkExpander().expand(ONELINK)).rejects.toMatchObject({ code: 'OFFER_URL_UNSUPPORTED' });
      }
    });

    it('corpo cortado em 32 KiB: input depois do limite não é achado → URL atual', async () => {
      const fn = stubFetch(async () => page(' '.repeat(32 * 1024) + FIXTURE));
      expect((await new HttpShortLinkExpander().expand(ONELINK)).href).toBe(ONELINK.href);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('sem input → URL atual; input antes do limite é achado', async () => {
      stubFetch(async () => page('<html><input id="other" value="https://br.shein.com/x"></html>'));
      expect((await new HttpShortLinkExpander().expand(ONELINK)).href).toBe(ONELINK.href);
      stubFetch(async () => page(FIXTURE + ' '.repeat(64 * 1024)));
      expect((await new HttpShortLinkExpander().expand(ONELINK)).href).toBe(PRODUCT_URL);
    });

    it('3xx para fora da allowlist é recusado sem ser buscado', async () => {
      const fn = stubFetch(async () => redirect('https://evil.example.com/x'));
      await expect(new HttpShortLinkExpander().expand(ONELINK)).rejects.toMatchObject({ code: 'OFFER_URL_UNSUPPORTED' });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('onelink em cadeia conta no limite de saltos', async () => {
      let n = 0;
      const fn = stubFetch(async () => redirect(`https://onelink.shein.com/h${n++}`));
      await expect(new HttpShortLinkExpander().expand(ONELINK)).rejects.toMatchObject({ code: 'OFFER_URL_UNSUPPORTED' });
      expect(fn).toHaveBeenCalledTimes(6);
      expect(fn.mock.calls.every((c) => c[1].method === 'GET')).toBe(true);
    });

    it('falha de rede → indisponível; isShortLink reconhece o onelink', async () => {
      stubFetch(async () => {
        throw new TypeError('fetch failed');
      });
      await expect(new HttpShortLinkExpander().expand(ONELINK)).rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
      expect(isShortLink(ONELINK)).toBe(true);
      expect(isShortLink(new URL('https://br.shein.com/p-1.html'))).toBe(false);
    });
  });

  it('outros hosts não leem o corpo (cancelado)', async () => {
    const cancel = vi.fn(async () => undefined);
    stubFetch(async () => {
      const res = new Response('<input id="url" value="https://shopee.com.br/x">', { status: 200 });
      vi.spyOn(res.body!, 'cancel').mockImplementation(cancel);
      return res;
    });
    expect((await new HttpShortLinkExpander().expand(SHORT)).href).toBe(SHORT.href);
    expect(cancel).toHaveBeenCalled();
  });
});
