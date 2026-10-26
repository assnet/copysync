import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpOfferImageFetcher, isAllowedImageUrl } from './HttpOfferImageFetcher';

const OK_URL = 'https://down-br.img.susercontent.com/file/abc?token=1';

function stubFetch(impl: () => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('HttpOfferImageFetcher', () => {
  it('baixa imagem válida', async () => {
    stubFetch(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg; q=1' } }));
    const out = await new HttpOfferImageFetcher().fetch(OK_URL);
    expect(out?.mimeType).toBe('image/jpeg');
    expect(out?.buffer.length).toBe(3);
  });

  it.each(['https://evil.com/a.jpg', 'http://cf.shopee.com.br/a.jpg', 'https://cf.shopee.com.br:8443/a', 'https://xsusercontent.com/a', 'nao-url'])(
    'recusa %s sem rede',
    async (url) => {
      const fn = stubFetch(async () => new Response(''));
      expect(await new HttpOfferImageFetcher().fetch(url)).toBeNull();
      expect(fn).not.toHaveBeenCalled();
    },
  );

  it('recusa content-type não imagem', async () => {
    stubFetch(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    expect(await new HttpOfferImageFetcher().fetch(OK_URL)).toBeNull();
  });

  it('recusa content-length acima de 5 MB', async () => {
    stubFetch(async () => new Response('x', { headers: { 'content-type': 'image/png', 'content-length': String(6 * 1024 * 1024) } }));
    expect(await new HttpOfferImageFetcher().fetch(OK_URL)).toBeNull();
  });

  it('recusa stream acima de 5 MB sem content-length', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ < 6) c.enqueue(chunk);
        else c.close();
      },
    });
    stubFetch(async () => new Response(body, { headers: { 'content-type': 'image/png' } }));
    expect(await new HttpOfferImageFetcher().fetch(OK_URL)).toBeNull();
  });

  it('erro de rede e HTTP 404 → null', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await new HttpOfferImageFetcher().fetch(OK_URL)).toBeNull();
    stubFetch(async () => new Response('', { status: 404, headers: { 'content-type': 'image/png' } }));
    expect(await new HttpOfferImageFetcher().fetch(OK_URL)).toBeNull();
  });
});

describe('isAllowedImageUrl — CDNs de ML e Amazon', () => {
  it.each([
    ['https://http2.mlstatic.com/D_NQ_NP_1.jpg', true],
    ['https://m.media-amazon.com/images/I/k.jpg', true],
    ['https://images-na.ssl-images-amazon.com/images/I/k.jpg', true],
    ['https://evilmlstatic.com/a.jpg', false],
    ['https://media-amazon.com.evil.com/a.jpg', false],
  ])('%s → %s', (url, ok) => {
    expect(isAllowedImageUrl(new URL(url))).toBe(ok);
  });
});
