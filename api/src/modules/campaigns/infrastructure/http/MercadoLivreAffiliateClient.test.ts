import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AffiliateApiRateLimitedError,
  AffiliateApiUnavailableError,
  AffiliateCredentialRejectedError,
} from '../../../../shared/errors/internal/OfferErrors';
import { MercadoLivreAffiliateClient } from './MercadoLivreAffiliateClient';

const COOKIES = { ssid: 'sessao-abc' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function bootstrapOk(): Response {
  return new Response('<html></html>', { status: 200, headers: { 'set-cookie': '_csrf=tok123; Path=/' } });
}

/** 1ª chamada = bootstrap do Link Builder; demais = `tags` (ou o que for passado). */
function stubFetch(...after: Array<() => Promise<Response>>) {
  const queue = [async () => bootstrapOk(), ...after];
  const fn = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('fetch inesperado');
    return next();
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MercadoLivreAffiliateClient.listAccountTags', () => {
  const client = () => new MercadoLivreAffiliateClient();

  it('uma etiqueta ativa', async () => {
    const fn = stubFetch(async () => json([{ tag: ' minhaloja ', in_use: true }]));
    expect(await client().listAccountTags(COOKIES)).toEqual({ tags: ['minhaloja'], active: 'minhaloja' });
    const [url, init] = fn.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('https://www.mercadolivre.com.br/affiliate-program/api/v2/stripe/user/tags');
    expect((init.headers as Record<string, string>)['X-Csrf-Token']).toBe('tok123');
  });

  it('várias etiquetas na ordem da resposta, sem repetir', async () => {
    stubFetch(async () =>
      json([{ tag: 'a' }, { tag: 'b', inUse: true }, { tag: 'a' }, { tag: 'c', in_use: false }]),
    );
    expect(await client().listAccountTags(COOKIES)).toEqual({ tags: ['a', 'b', 'c'], active: 'b' });
  });

  it('nenhuma em uso → active null', async () => {
    stubFetch(async () => json([{ tag: 'a' }, { tag: 'b' }]));
    expect(await client().listAccountTags(COOKIES)).toEqual({ tags: ['a', 'b'], active: null });
  });

  it('aceita formato { tags: [...] }', async () => {
    stubFetch(async () => json({ tags: [{ tag: 'x', in_use: true }, { tag: 'y' }] }));
    expect(await client().listAccountTags(COOKIES)).toEqual({ tags: ['x', 'y'], active: 'x' });
  });

  it('item sem tag, tag vazia ou não string é ignorado', async () => {
    stubFetch(async () => json([{ in_use: false }, { tag: '   ' }, { tag: 42 }, null, 'solta', { tag: 'ok' }]));
    expect(await client().listAccountTags(COOKIES)).toEqual({ tags: ['ok'], active: null });
  });

  it('lista vazia → tags []', async () => {
    stubFetch(async () => json({ tags: [] }));
    expect(await client().listAccountTags(COOKIES)).toEqual({ tags: [], active: null });
  });

  it('formato sem lista → tags null', async () => {
    stubFetch(async () => json({ foo: 1 }));
    expect(await client().listAccountTags(COOKIES)).toEqual({ tags: null, active: null });
  });

  it('falha de rede na chamada de tags → tags null sem lançar', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await client().listAccountTags(COOKIES)).toEqual({ tags: null, active: null });
  });

  it('JSON ilegível → tags null sem lançar', async () => {
    stubFetch(async () => new Response('<html>oops', { status: 200 }));
    expect(await client().listAccountTags(COOKIES)).toEqual({ tags: null, active: null });
  });

  it.each([401, 403])('%i → AffiliateCredentialRejectedError', async (status) => {
    stubFetch(async () => json({}, status));
    await expect(client().listAccountTags(COOKIES)).rejects.toBeInstanceOf(AffiliateCredentialRejectedError);
  });

  it('429 → AffiliateApiRateLimitedError', async () => {
    stubFetch(async () => json({}, 429));
    await expect(client().listAccountTags(COOKIES)).rejects.toBeInstanceOf(AffiliateApiRateLimitedError);
  });

  it('403 no bootstrap segue = sessão recusada (helper compartilhado com o hub)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 403 })));
    await expect(client().listAccountTags(COOKIES)).rejects.toBeInstanceOf(AffiliateCredentialRejectedError);
  });

  it('bootstrap: salto fora do hub segue = recusada; salto sem https nunca é seguido', async () => {
    const redirect = (location: string) => vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
    vi.stubGlobal('fetch', redirect('https://www.mercadolivre.com.br/gz/challenge'));
    await expect(client().listAccountTags(COOKIES)).rejects.toBeInstanceOf(AffiliateCredentialRejectedError);
    const fn = redirect('http://www.mercadolivre.com.br/afiliados/linkbuilder');
    vi.stubGlobal('fetch', fn);
    await expect(client().listAccountTags(COOKIES)).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('MercadoLivreAffiliateClient.getActiveTag', () => {
  it('devolve a ativa da lista', async () => {
    stubFetch(async () => json([{ tag: 'a' }, { tag: 'b', in_use: true }]));
    expect(await new MercadoLivreAffiliateClient().getActiveTag(COOKIES)).toBe('b');
  });

  it('rede falha → null', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await new MercadoLivreAffiliateClient().getActiveTag(COOKIES)).toBeNull();
  });
});

describe('MercadoLivreAffiliateClient.createAffiliateLinks', () => {
  it('sem tag usa a ativa da conta', async () => {
    const fn = stubFetch(
      async () => json([{ tag: 'ativa', in_use: true }]),
      async () => json({ urls: [{ origin_url: 'https://ml/x', short_url: 'https://meli.la/1', long_url: 'https://l' }] }),
    );
    const out = await new MercadoLivreAffiliateClient().createAffiliateLinks(COOKIES, ['https://ml/x']);
    expect(out).toEqual({
      success: [{ originUrl: 'https://ml/x', shortUrl: 'https://meli.la/1', longUrl: 'https://l' }],
      errors: [],
    });
    const [, init] = fn.mock.calls[2] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ urls: ['https://ml/x'], tag: 'ativa' });
  });
});
