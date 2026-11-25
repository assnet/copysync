import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.hoisted(() => vi.fn());
vi.mock('../../../../shared/logger/logger', () => ({
  logger: { child: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import fixtures from './__fixtures__/kabumCatalog.json';
import { KabumCatalogClient, reaisToCents } from './KabumCatalogClient';
import { USER_AGENT } from './HttpShortLinkExpander';
import { AffiliateApiUnavailableError } from '../../../../shared/errors/internal/OfferErrors';

// Respostas reais gravadas em 2026-11-24 (reduzidas). Oferta: starts_at 1795434804, ends_at 1795698000.
const DURING_OFFER = 1_795_569_421_000;
const AFTER_OFFER = 1_795_698_000_000;

type Body = { type: string; id: string; attributes: Record<string, unknown> };
const clone = (b: unknown) => structuredClone(b) as Body;
const OFFER = () => clone(fixtures.productWithOffer);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(impl: (...a: unknown[]) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

const get = (id = '112948', now = DURING_OFFER) => new KabumCatalogClient(() => now).getProduct(id);
const withAttrs = (patch: (a: Record<string, unknown>) => void) => {
  const b = OFFER();
  patch(b.attributes);
  return b;
};

beforeEach(() => warn.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe('KabumCatalogClient', () => {
  it('resposta real com oferta ativa → preço da oferta; request fixo', async () => {
    const fn = stubFetch(async () => json(fixtures.productWithOffer));
    expect(await get()).toEqual({
      title:
        'Mouse Gamer Logitech G203 LIGHTSYNC RGB, Efeito de Ondas de Cores, 6 Botões Programáveis e Até 8.000 DPI, Preto - 910-005793',
      priceCents: 9999,
      originalPriceCents: null,
      imageUrl: (fixtures.productWithOffer.attributes.images as string[])[0],
      available: true,
    });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://servicespub.prod.api.aws.grupokabum.com.br/catalog/v2/products/112948');
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
  });

  it('oferta encerrada → price_with_discount (à vista)', async () => {
    stubFetch(async () => json(fixtures.productWithOffer));
    expect((await get('112948', AFTER_OFFER))?.priceCents).toBe(16999);
  });

  it.each([
    ['sem estoque da oferta', (o: Record<string, unknown>) => (o.quantity_available = 0)],
    ['oferta ainda não começou', (o: Record<string, unknown>) => (o.starts_at = 1_795_600_000)],
    ['exclusiva de usuário logado', (o: Record<string, unknown>) => (o.is_logged_user_exclusive = true)],
    ['sem fim', (o: Record<string, unknown>) => delete o.ends_at],
  ])('oferta inativa (%s) → price_with_discount', async (_n, patch) => {
    const b = OFFER();
    patch(b.attributes.offer as Record<string, unknown>);
    stubFetch(async () => json(b));
    expect((await get())?.priceCents).toBe(16999);
  });

  it('sem oferta e sem price_with_discount → price', async () => {
    stubFetch(async () => json(withAttrs((a) => ((a.offer = null), (a.price_with_discount = 0)))));
    expect((await get())?.priceCents).toBe(19999);
  });

  it('old_price > preço → original; 0 ou ≤ preço → null', async () => {
    stubFetch(async () => json(withAttrs((a) => (a.old_price = 249.9))));
    expect((await get())?.originalPriceCents).toBe(24990);
    stubFetch(async () => json(withAttrs((a) => (a.old_price = 99.99))));
    expect((await get())?.originalPriceCents).toBeNull();
    stubFetch(async () => json(withAttrs((a) => (a.old_price = 0))));
    expect((await get())?.originalPriceCents).toBeNull();
  });

  it('reais → centavos sem erro de ponto flutuante', () => {
    expect(reaisToCents(169.99)).toBe(16999);
    expect(reaisToCents(0.29)).toBe(29);
    expect(reaisToCents(1.005)).toBe(101);
    expect(reaisToCents(4589.9)).toBe(458990);
    expect(reaisToCents('19.9')).toBe(1990);
    expect(reaisToCents(0)).toBeNull();
    expect(reaisToCents(-1)).toBeNull();
    expect(reaisToCents('R$ 10')).toBeNull();
  });

  it('available=false (resposta real) → null', async () => {
    stubFetch(async () => json(fixtures.productUnavailable3P));
    expect(await get('480581')).toBeNull();
  });

  it('sem título ou sem preço → null', async () => {
    stubFetch(async () => json(withAttrs((a) => (a.title = '  '))));
    expect(await get()).toBeNull();
    stubFetch(async () => json(withAttrs((a) => ((a.offer = null), (a.price_with_discount = 0), (a.price = 0)))));
    expect(await get()).toBeNull();
  });

  it('foto http:// → https://; sem images usa photos.gg; host estranho → null', async () => {
    stubFetch(async () =>
      json(withAttrs((a) => (a.images = ['http://images.kabum.com.br/produtos/fotos/112948/x_original.jpg']))),
    );
    expect((await get())?.imageUrl).toBe('https://images.kabum.com.br/produtos/fotos/112948/x_original.jpg');
    stubFetch(async () => json(withAttrs((a) => (a.images = []))));
    expect((await get())?.imageUrl).toBe((fixtures.productWithOffer.attributes.photos.gg as string[])[0]);
    stubFetch(async () =>
      json(withAttrs((a) => ((a.images = ['https://evil.example/x.jpg']), (a.photos = {})))),
    );
    expect((await get())?.imageUrl).toBeNull();
  });

  it('id não numérico → null sem rede', async () => {
    const fn = stubFetch(async () => json(fixtures.productWithOffer));
    for (const id of ['', 'abc', '12a', '../1', '1234567890123']) expect(await get(id)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('404 (resposta real) → null', async () => {
    stubFetch(async () => json(fixtures.notFound, 404));
    expect(await get('999999999')).toBeNull();
  });

  it.each([301, 302, 403, 500, 503])('status %i → indisponível', async (status) => {
    stubFetch(async () => new Response(null, { status }));
    await expect(get()).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
  });

  it('timeout / erro de rede → indisponível', async () => {
    stubFetch(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    await expect(get()).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
    expect(warn).toHaveBeenCalledWith({ reason: 'TimeoutError' }, expect.any(String));
  });

  it('JSON inválido ou fora do formato → indisponível', async () => {
    stubFetch(async () => new Response('<html>', { status: 200 }));
    await expect(get()).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
    stubFetch(async () => json({ data: [] }));
    await expect(get()).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
  });

  it('corpo acima de 256 KiB → indisponível', async () => {
    const big = JSON.stringify({ ...OFFER(), pad: 'x'.repeat(256 * 1024) });
    stubFetch(async () => new Response(big, { status: 200 }));
    await expect(get()).rejects.toBeInstanceOf(AffiliateApiUnavailableError);
    expect(warn).toHaveBeenCalledWith({ reason: 'too_large' }, expect.any(String));
  });
});
