import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpShortLinkExpander } from './HttpShortLinkExpander';

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

  it('falha de rede → indisponível', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(new HttpShortLinkExpander().expand(SHORT)).rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
  });
});
