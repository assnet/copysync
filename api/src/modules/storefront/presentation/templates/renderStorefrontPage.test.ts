import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  renderStorefrontPage,
  storefrontComingSoonPage,
  storefrontPageCsp,
  storefrontPausedPage,
  STOREFRONT_PAGE_TEXT,
  type StorefrontPageModel,
  type StorefrontPageOffer,
  type StorefrontPageOptions,
} from './renderStorefrontPage';

const MEDIA = 'https://media.exemplo.app';
const OPTS: StorefrontPageOptions = { mediaOrigin: MEDIA, assetBaseUrl: 'https://painel.exemplo.app', isPreview: false };

const offer = (over: Partial<StorefrontPageOffer> = {}): StorefrontPageOffer => ({
  title: 'Fone Bluetooth',
  priceCents: 9990,
  originalPriceCents: 14990,
  imageUrl: `${MEDIA}/storefront/t1/offer-1.webp`,
  categoryKey: 'electronics',
  categoryLabel: 'Eletrônicos',
  affiliateUrl: 'https://loja.exemplo.com/p/123?aff=abc',
  ...over,
});

const model = (over: Partial<StorefrontPageModel> = {}): StorefrontPageModel => ({
  title: 'Achados da Ana',
  subtitle: 'Ofertas do dia',
  avatarUrl: `${MEDIA}/storefront/t1/avatar.webp`,
  coverUrl: `${MEDIA}/storefront/t1/cover.webp`,
  colors: { primary: '#2563eb', background: '#F5F5F5', card: '#FFFFFF' },
  categories: [
    { key: 'electronics', label: 'Eletrônicos' },
    { key: 'pet_shop', label: 'Pet Shop' },
  ],
  offers: [offer()],
  publicUrl: 'https://ana.exemplo.app/',
  ...over,
});

const styleOf = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';

describe('renderStorefrontPage', () => {
  it('botão "Ver oferta" abre em nova aba com rel nofollow sponsored noopener', () => {
    const { html } = renderStorefrontPage(model(), OPTS);
    expect(html).toContain(
      '<a class="btn" href="https://loja.exemplo.com/p/123?aff=abc" target="_blank" rel="nofollow sponsored noopener">Ver oferta →</a>',
    );
  });

  it('escapa <script> no título, subtítulo e título da oferta', () => {
    const evil = '<script>alert(1)</script>';
    const { html } = renderStorefrontPage(
      model({ title: evil, subtitle: `"><img src=x onerror=alert(1)>`, offers: [offer({ title: evil })] }),
      OPTS,
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('cor inválida não entra no CSS e cai no padrão', () => {
    const { html } = renderStorefrontPage(
      model({ colors: { primary: 'red;}body{display:none', background: '#fff', card: 'url(x)' } }),
      OPTS,
    );
    const css = styleOf(html);
    expect(css).not.toContain('display:none}body');
    expect(css).not.toContain('red;');
    expect(css).not.toContain('url(x)');
    expect(css).toContain('--p:#2563EB');
    expect(css).toContain('--bg:#F5F5F5');
    expect(css).toContain('--card:#FFFFFF');
  });

  it('preview sem ofertas mostra selo e 3 exemplos, sem OG', () => {
    const { html } = renderStorefrontPage(model({ offers: [] }), { ...OPTS, isPreview: true });
    expect(html).toContain(STOREFRONT_PAGE_TEXT.sampleBadge);
    expect(html.match(/<li class="card/g)).toHaveLength(3);
    expect(html).not.toContain('og:title');
    expect(html).toContain('noindex');
  });

  it('página pública nunca mostra exemplos, mesmo sem ofertas', () => {
    const { html } = renderStorefrontPage(model({ offers: [] }), OPTS);
    expect(html).not.toContain(STOREFRONT_PAGE_TEXT.sampleBadge);
    expect(html).not.toContain('<li class="card');
  });

  it('página pública tem OG com a capa', () => {
    const { html } = renderStorefrontPage(model(), OPTS);
    expect(html).toContain('<meta property="og:title" content="Achados da Ana">');
    expect(html).toContain('<meta property="og:description" content="Ofertas do dia">');
    expect(html).toContain(`<meta property="og:image" content="${MEDIA}/storefront/t1/cover.webp">`);
  });

  it('styleHash é o sha256 do conteúdo do <style>', () => {
    const { html, styleHash } = renderStorefrontPage(model(), OPTS);
    const expected = createHash('sha256').update(styleOf(html)).digest('base64');
    expect(styleHash).toBe(`sha256-${expected}`);
  });

  it('cores diferentes mudam o hash', () => {
    const a = renderStorefrontPage(model(), OPTS).styleHash;
    const b = renderStorefrontPage(model({ colors: { primary: '#000000', background: '#FFFFFF', card: '#FFFFFF' } }), OPTS).styleHash;
    expect(a).not.toBe(b);
  });

  it('HTML com 60 ofertas fica abaixo de 60 KB', () => {
    const offers = Array.from({ length: 60 }, (_, i) =>
      offer({
        title: `Produto de teste com um título bem comprido para ocupar as duas linhas do card número ${i}`,
        imageUrl: `${MEDIA}/storefront/tenant-0000-0000-0000/offer-${i}-aaaaaaaaaaaaaaaa.webp`,
        affiliateUrl: `https://loja.exemplo.com/produto/MLB${1000000 + i}?matt_tool=12345678&matt_word=afiliado&ref=abc${i}`,
        categoryKey: i % 2 ? 'electronics' : 'pet_shop',
        categoryLabel: i % 2 ? 'Eletrônicos' : 'Pet Shop',
      }),
    );
    const { html } = renderStorefrontPage(model({ offers }), OPTS);
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(60 * 1024);
  });

  it('imagem fora do mediaOrigin cai no fallback (iniciais / sem imagem)', () => {
    const { html } = renderStorefrontPage(
      model({
        avatarUrl: 'https://evil.exemplo.com/a.webp',
        coverUrl: 'http://media.exemplo.app/c.webp',
        offers: [offer({ imageUrl: 'https://evil.exemplo.com/o.webp' })],
      }),
      OPTS,
    );
    expect(html).not.toContain('evil.exemplo.com');
    expect(html).not.toContain('http://media.exemplo.app');
    expect(html).toContain('<span class="av" aria-hidden="true">AA</span>');
    expect(html).toContain('<span class="im" aria-hidden="true"></span>');
  });

  it('sem mediaOrigin nenhuma imagem do tenant sai', () => {
    const { html } = renderStorefrontPage(model(), { ...OPTS, mediaOrigin: null });
    expect(html).not.toContain(MEDIA);
  });

  it('chips: "Todas" + só categorias com oferta, filtro por :checked', () => {
    const { html } = renderStorefrontPage(model(), OPTS);
    expect(html).toContain('<label for="c-all">Todas</label>');
    expect(html).toContain('<label for="c-electronics">Eletrônicos</label>');
    expect(html).not.toContain('c-pet_shop');
    expect(styleOf(html)).toContain('#c-electronics:checked~.grid .card:not(.k-electronics){display:none}');
  });

  it('chave fora do catálogo não vira chip nem seletor CSS', () => {
    const { html } = renderStorefrontPage(
      model({ categories: [{ key: 'x}body{color:red', label: 'X' }], offers: [offer({ categoryKey: 'x}body{color:red' })] }),
      OPTS,
    );
    expect(html).not.toContain('color:red');
  });

  it('link de afiliado não http(s) derruba o card', () => {
    const { html } = renderStorefrontPage(model({ offers: [offer({ affiliateUrl: 'javascript:alert(1)' })] }), OPTS);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<li class="card');
  });

  it('preço em R$ pt-BR com "de" riscado e rodapé com a marca', () => {
    const { html } = renderStorefrontPage(model(), OPTS);
    expect(html).toMatch(/<s>de R\$\s99,90|<s>de R\$\s149,90/);
    expect(html).toMatch(/<b>R\$\s99,90<\/b>/);
    expect(html).toMatch(/<footer>Feito com [^<]+<\/footer>/);
  });
});

describe('storefrontPageCsp', () => {
  it('libera só o hash do estilo e as origens https de mídia e marca', () => {
    const csp = storefrontPageCsp({ styleHash: 'sha256-abc', mediaOrigin: MEDIA, assetBaseUrl: 'https://painel.exemplo.app/x' });
    expect(csp).toContain("style-src 'sha256-abc'");
    expect(csp).toContain(`img-src https://painel.exemplo.app ${MEDIA}`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');
  });

  it('sem origens, img-src none', () => {
    expect(storefrontPageCsp({ styleHash: 'sha256-abc', mediaOrigin: null, assetBaseUrl: null })).toContain("img-src 'none'");
  });
});

describe('páginas de estado', () => {
  it('em breve e pausada usam o layout com hash do <style>', () => {
    for (const page of [storefrontComingSoonPage('Achados'), storefrontPausedPage('Achados')]) {
      const expected = createHash('sha256').update(styleOf(page.html)).digest('base64');
      expect(page.styleHash).toBe(`sha256-${expected}`);
    }
    expect(storefrontComingSoonPage('Achados').html).toContain(STOREFRONT_PAGE_TEXT.comingSoonHeading);
    expect(storefrontPausedPage('<b>x</b>').html).not.toContain('<b>x</b>');
  });
});
