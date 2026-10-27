import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpProductPageReader, sendsMlCookie } from './HttpProductPageReader';

const HTML = '<html><head><meta property="og:title" content="Fone X"><meta property="og:image" content="https://http2.mlstatic.com/a.jpg"><meta property="product:price:amount" content="99.90"></head></html>';

function html(body = HTML, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
}

function stubFetch(impl: (url: URL, init: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

const ML = new URL('https://produto.mercadolivre.com.br/MLB-1-fone?matt_word=etq');
const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

describe('HttpProductPageReader', () => {
  it('lê og:* e preço com UA de navegador e redirect manual', async () => {
    const fn = stubFetch(async () => html());
    const out = await new HttpProductPageReader().read({ url: ML });
    expect(out).toMatchObject({ title: 'Fone X', imageUrl: 'https://http2.mlstatic.com/a.jpg', priceCents: 9990 });
    const init = fn.mock.calls[0][1];
    expect(init.redirect).toBe('manual');
    expect(headersOf(init)['User-Agent']).toContain('Chrome');
    expect(headersOf(init).Cookie).toBeUndefined();
  });

  it('cookie ssid só para host do ML', async () => {
    const fn = stubFetch(async (url) =>
      url.hostname === 'produto.mercadolivre.com.br'
        ? new Response(null, { status: 302, headers: { location: 'https://www.mercadolivre.com/p/MLB1' } })
        : html(),
    );
    await new HttpProductPageReader().read({ url: ML, mercadoLivreCookies: { ssid: 'tok123' } });
    expect(headersOf(fn.mock.calls[0][1]).Cookie).toBe('ssid=tok123');
    expect(headersOf(fn.mock.calls[1][1]).Cookie).toBeUndefined();
  });

  it('cookie ssid conferido a cada salto: só em caminho de produto do ML', async () => {
    const chain: Record<string, string> = {
      '/MLB-1-fone': 'https://www.mercadolivre.com.br/login?go=1',
      '/login': 'https://www.mercadolivre.com.br/fone-x/p/MLB123',
    };
    const fn = stubFetch(async (url) =>
      chain[url.pathname] ? new Response(null, { status: 302, headers: { location: chain[url.pathname] } }) : html(),
    );
    await new HttpProductPageReader().read({ url: ML, mercadoLivreCookies: { ssid: 'tok123' } });
    expect(fn.mock.calls.map((c) => headersOf(c[1]).Cookie)).toEqual(['ssid=tok123', undefined, 'ssid=tok123']);
  });

  it.each([
    ['https://produto.mercadolivre.com.br/qualquer', true],
    ['https://www.mercadolivre.com.br/MLB-123-x', true],
    ['https://www.mercadolivre.com.br/p/MLB123', true],
    ['https://www.mercadolivre.com.br/fone/p/MLB123', true],
    ['https://www.mercadolivre.com.br/up/MLBU123', true],
    ['https://www.mercadolivre.com.br/social/etq', true],
    ['https://www.mercadolivre.com.br/', false],
    ['https://www.mercadolivre.com.br/ofertas', false],
    ['https://lista.mercadolivre.com.br/fone', false],
    ['https://www.mercadolivre.com/p/MLB1', false],
    ['https://www.amazon.com.br/MLB-1', false],
  ])('sendsMlCookie(%s) → %s', (url, expected) => {
    expect(sendsMlCookie(new URL(url))).toBe(expected);
  });

  it('token com caractere de cookie não é enviado', async () => {
    const fn = stubFetch(async () => html());
    await new HttpProductPageReader().read({ url: ML, mercadoLivreCookies: { ssid: 'a; other=1' } });
    expect(headersOf(fn.mock.calls[0][1]).Cookie).toBeUndefined();
  });

  it('redirect para fora da allowlist não é buscado → null', async () => {
    const fn = stubFetch(async () => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/' } }));
    expect(await new HttpProductPageReader().read({ url: ML })).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('muitos redirects → null', async () => {
    const fn = stubFetch(async () => new Response(null, { status: 302, headers: { location: ML.href } }));
    expect(await new HttpProductPageReader().read({ url: ML })).toBeNull();
    expect(fn).toHaveBeenCalledTimes(6);
  });

  it('URL fora da allowlist nem é requisitada', async () => {
    const fn = stubFetch(async () => html());
    expect(await new HttpProductPageReader().read({ url: new URL('https://evil.com/x') })).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('não-HTML, 403 ou erro de rede → null', async () => {
    stubFetch(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(await new HttpProductPageReader().read({ url: ML })).toBeNull();
    stubFetch(async () => new Response('x', { status: 403, headers: { 'content-type': 'text/html' } }));
    expect(await new HttpProductPageReader().read({ url: ML })).toBeNull();
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await new HttpProductPageReader().read({ url: ML })).toBeNull();
  });

  it('corpo acima de 2 MB: lê só o começo', async () => {
    const big = HTML + 'x'.repeat(3 * 1024 * 1024) + '<meta property="og:title" content="late">';
    stubFetch(async () => html(big));
    const out = await new HttpProductPageReader().read({ url: ML });
    expect(out?.title).toBe('Fone X');
  });
});
