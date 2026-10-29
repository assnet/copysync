import { createHash } from 'node:crypto';
import { APP_NAME } from '../../../../shared/branding/brand';
import { escapeHtml, renderPublicPage } from '../../../link-rotation/presentation/templates/publicLinkLayout';
import { isStorefrontCategory } from '../../domain/services/storefrontCategories';
import { normalizeHexColor, STOREFRONT_DEFAULT_COLORS } from '../../domain/services/storefrontRules';

/** Textos da página pública (pt-BR). Chaves semânticas; a marca só entra via `APP_NAME`. */
export const STOREFRONT_PAGE_TEXT = {
  all: 'Todas',
  filterLabel: 'Filtrar por categoria',
  from: 'de',
  cta: 'Ver oferta →',
  madeWith: 'Feito com',
  sampleBadge: 'Ofertas de exemplo',
  defaultDescription: 'Ofertas selecionadas com link direto para a loja.',
  comingSoonHeading: 'Em breve',
  comingSoon: 'As ofertas desta página estão chegando. Volte daqui a pouco.',
  pausedHeading: 'Página em pausa',
  paused: 'Esta página está pausada no momento. Tente de novo mais tarde.',
} as const;

const T = STOREFRONT_PAGE_TEXT;

export interface StorefrontPageOffer {
  title: string;
  priceCents: number | null;
  originalPriceCents: number | null;
  imageUrl: string | null;
  categoryKey: string | null;
  categoryLabel: string | null;
  affiliateUrl: string;
}

export interface StorefrontPageModel {
  title: string;
  subtitle: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  colors: { primary: string; background: string; card: string };
  /** Categorias da página, na ordem escolhida. Só as que têm oferta viram chip. */
  categories: { key: string; label: string }[];
  /** Publicadas, na ordem de exibição. */
  offers: StorefrontPageOffer[];
  publicUrl: string;
}

export interface StorefrontPageOptions {
  /** Origem pública do armazenamento de mídia (`S3_PUBLIC_URL`); sem ela, nenhuma imagem. */
  mediaOrigin: string | null;
  /** Origem do painel (arquivos em `/assets/brand/`). */
  assetBaseUrl: string | null;
  /** Prévia do painel: sem OG, `noindex` e, sem ofertas, exemplos fixos com selo. */
  isPreview: boolean;
  /** Força a grade da prévia (toggle Mobile/Desktop); omitido = media query. */
  viewport?: 'mobile' | 'desktop';
}

export interface RenderedStorefrontPage {
  html: string;
  /** `sha256-<base64>` do conteúdo exato do `<style>`, para a CSP da resposta. */
  styleHash: string;
}

const httpsOrigin = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
};

// SPEC_DEVIATION: não usa `allowedMediaUrl` do rodízio. Reason: ele lê a origem de um estado de
// módulo (`configurePublicPageBranding`); aqui a origem vem em `opts.mediaOrigin` para a função
// ficar pura e a CSP sair da mesma fonte. Mesma regra: só https e mesma origem.
const mediaUrl = (url: string | null | undefined, mediaOrigin: string | null): string | null => {
  const origin = httpsOrigin(mediaOrigin);
  return url && origin && httpsOrigin(url) === origin ? url : null;
};

/** Link de afiliado só http(s): `javascript:` e afins derrubam o card. */
const safeHref = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
};

const sha256 = (css: string): string => `sha256-${createHash('sha256').update(css).digest('base64')}`;

/** Hash do primeiro `<style>` de um HTML já renderizado (páginas de estado do rodízio). */
function styleHashOf(html: string): string {
  return sha256(/<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '');
}

/** Texto legível sobre a cor: preto ou branco pela luminância relativa (WCAG). */
function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#16181D' : '#FFFFFF';
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (cents: number): string => BRL.format(cents / 100);

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return letters.map((w) => Array.from(w)[0] ?? '').join('').toUpperCase() || '#';
}

/** Exemplos fixos da prévia sem ofertas. Nunca saem na página pública. */
const SAMPLE_OFFERS: StorefrontPageOffer[] = [
  { title: 'Fone de ouvido sem fio com cancelamento de ruído', priceCents: 19990, originalPriceCents: 29990, imageUrl: null, categoryKey: null, categoryLabel: 'Eletrônicos', affiliateUrl: 'https://example.com/' },
  { title: 'Kit 3 camisetas básicas algodão', priceCents: 8990, originalPriceCents: 12990, imageUrl: null, categoryKey: null, categoryLabel: 'Moda Masculina', affiliateUrl: 'https://example.com/' },
  { title: 'Air fryer 4 litros antiaderente', priceCents: 34900, originalPriceCents: null, imageUrl: null, categoryKey: null, categoryLabel: 'Casa & Decoração', affiliateUrl: 'https://example.com/' },
];

// CSS fixo; o variável (cores e filtros por categoria) é anexado por página e entra no hash.
const BASE_CSS = [
  '*{box-sizing:border-box}',
  'body{margin:0;background:var(--bg);color:var(--on-bg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  'main{max-width:1040px;margin:0 auto;padding:0 16px 32px}',
  '.cv{aspect-ratio:3/1;margin:0 -16px;background:var(--p);overflow:hidden}',
  '.cv img{display:block;width:100%;height:100%;object-fit:cover}',
  'header{text-align:center}',
  '.av{display:flex;align-items:center;justify-content:center;width:96px;height:96px;margin:-48px auto 12px;border-radius:50%;border:4px solid var(--bg);background:var(--p);color:var(--on-p);font-weight:700;font-size:2rem;object-fit:cover;position:relative}',
  'h1{margin:0;font-size:1.5rem;line-height:1.25;overflow-wrap:anywhere}',
  '.sub{margin:4px 0 0;opacity:.75;overflow-wrap:anywhere}',
  '.badge{display:inline-block;margin-top:12px;padding:4px 12px;border-radius:999px;border:1px dashed currentColor;font-size:.8125rem;font-weight:600}',
  '.r{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}',
  '.chips{display:flex;gap:8px;overflow-x:auto;margin:20px 0 16px;padding:2px}',
  '.chips label{flex:none;padding:6px 14px;border-radius:999px;background:var(--card);color:var(--on-card);border:1px solid rgba(127,127,127,.3);cursor:pointer;font-size:.875rem;white-space:nowrap}',
  '.grid{display:grid;grid-template-columns:1fr;gap:16px;margin:0;padding:0;list-style:none}',
  '@media (min-width:641px){.grid{grid-template-columns:repeat(2,1fr)}}',
  '@media (min-width:960px){.grid{grid-template-columns:repeat(3,1fr)}}',
  '.vm .grid{grid-template-columns:1fr}',
  '.vd .grid{grid-template-columns:repeat(3,1fr)}',
  '.card{display:flex;flex-direction:column;background:var(--card);color:var(--on-card);border-radius:16px;overflow:hidden;border:1px solid rgba(127,127,127,.2)}',
  '.im{aspect-ratio:1;background:rgba(127,127,127,.12);display:block;width:100%;object-fit:contain}',
  '.bd{display:flex;flex-direction:column;flex:1;gap:4px;padding:12px 14px 14px}',
  '.ct{font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;opacity:.7}',
  '.tt{margin:0;font-size:1rem;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
  '.pr{margin-top:auto;padding-top:4px}',
  '.pr s{display:block;font-size:.8125rem;opacity:.6}',
  '.pr b{font-size:1.25rem}',
  '.btn{display:block;margin-top:10px;padding:12px;border-radius:12px;background:var(--p);color:var(--on-p);text-align:center;font-weight:700;text-decoration:none}',
  '.btn:focus-visible,.chips label:focus-visible{outline:3px solid var(--on-bg);outline-offset:2px}',
  'footer{padding:24px 16px;text-align:center;font-size:.75rem;opacity:.7}',
].join('');

function pageCss(colors: { primary: string; background: string; card: string }, chipKeys: string[]): string {
  const vars = `:root{color-scheme:light;--p:${colors.primary};--on-p:${textOn(colors.primary)};--bg:${colors.background};--on-bg:${textOn(colors.background)};--card:${colors.card};--on-card:${textOn(colors.card)}}`;
  const ids = ['all', ...chipKeys];
  const active = ids.map((k) => `#c-${k}:checked~.chips label[for=c-${k}]`).join(',');
  const focus = ids.map((k) => `#c-${k}:focus-visible~.chips label[for=c-${k}]`).join(',');
  const filters = chipKeys.map((k) => `#c-${k}:checked~.grid .card:not(.k-${k})`).join(',');
  return [
    vars,
    BASE_CSS,
    `${active}{background:var(--p);color:var(--on-p);border-color:var(--p)}`,
    `${focus}{outline:3px solid var(--on-bg);outline-offset:2px}`,
    filters ? `${filters}{display:none}` : '',
  ].join('');
}

function offerCard(offer: StorefrontPageOffer, chipKeys: ReadonlySet<string>, mediaOrigin: string | null): string {
  const href = safeHref(offer.affiliateUrl);
  if (!href) return '';
  const key = offer.categoryKey && chipKeys.has(offer.categoryKey) ? offer.categoryKey : null;
  const img = mediaUrl(offer.imageUrl, mediaOrigin);
  const title = escapeHtml(offer.title);
  const image = img
    ? `<img class="im" src="${escapeHtml(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : '<span class="im" aria-hidden="true"></span>';
  const cat = offer.categoryLabel ? `<span class="ct">${escapeHtml(offer.categoryLabel)}</span>` : '';
  const showOriginal =
    offer.originalPriceCents !== null && (offer.priceCents === null || offer.originalPriceCents > offer.priceCents);
  const was = showOriginal ? `<s>${T.from} ${money(offer.originalPriceCents as number)}</s>` : '';
  const now = offer.priceCents !== null ? `<b>${money(offer.priceCents)}</b>` : '';
  const price = was || now ? `<div class="pr">${was}${now}</div>` : '';
  return `<li class="card${key ? ` k-${key}` : ''}">${image}<div class="bd">${cat}<h2 class="tt" title="${title}">${title}</h2>${price}<a class="btn" href="${escapeHtml(href)}" target="_blank" rel="nofollow sponsored noopener">${T.cta}</a></div></li>`;
}

/**
 * Página pública da vitrine, sem JS: filtro de categoria por radio + `:checked`. Função pura;
 * tudo que vem do tenant é escapado aqui. Cor fora de `#RRGGBB` cai no padrão (sem injeção de CSS).
 */
export function renderStorefrontPage(model: StorefrontPageModel, opts: StorefrontPageOptions): RenderedStorefrontPage {
  const colors = {
    primary: normalizeHexColor(model.colors.primary) ?? STOREFRONT_DEFAULT_COLORS.colorPrimary,
    background: normalizeHexColor(model.colors.background) ?? STOREFRONT_DEFAULT_COLORS.colorBackground,
    card: normalizeHexColor(model.colors.card) ?? STOREFRONT_DEFAULT_COLORS.colorCard,
  };
  const sample = opts.isPreview && model.offers.length === 0;
  const offers = sample ? SAMPLE_OFFERS : model.offers;
  const used = new Set(offers.map((o) => o.categoryKey).filter((k): k is string => !!k));
  // Chave vai para id/seletor CSS: só as do catálogo fixo (snake_case), sem duplicata.
  const chips = model.categories.filter(
    (c, i, all) => isStorefrontCategory(c.key) && used.has(c.key) && all.findIndex((x) => x.key === c.key) === i,
  );
  const chipKeys = chips.map((c) => c.key);
  const css = pageCss(colors, chipKeys);

  const cover = mediaUrl(model.coverUrl, opts.mediaOrigin);
  const avatar = mediaUrl(model.avatarUrl, opts.mediaOrigin);
  const brand = httpsOrigin(opts.assetBaseUrl);
  const brandAsset = (file: string) => (brand ? `${brand}/assets/brand/${file}` : null);
  const title = escapeHtml(model.title);
  const description = escapeHtml(model.subtitle || T.defaultDescription);
  const ogImage = cover ?? avatar ?? brandAsset('icon-512.png');
  const icon = brandAsset('favicon-32.png');
  const publicUrl = safeHref(model.publicUrl);

  const og = opts.isPreview
    ? ['<meta name="robots" content="noindex,nofollow">']
    : [
        `<meta property="og:title" content="${title}">`,
        `<meta property="og:description" content="${description}">`,
        '<meta property="og:type" content="website">',
        publicUrl ? `<meta property="og:url" content="${escapeHtml(publicUrl)}">` : '',
        ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : '',
        '<meta name="twitter:card" content="summary_large_image">',
      ];
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    ...og,
    icon ? `<link rel="icon" type="image/png" sizes="32x32" href="${escapeHtml(icon)}">` : '',
    `<style>${css}</style>`,
  ].filter(Boolean).join('');

  const coverHtml = `<div class="cv">${cover ? `<img src="${escapeHtml(cover)}" alt="" referrerpolicy="no-referrer">` : ''}</div>`;
  const avatarHtml = avatar
    ? `<img class="av" src="${escapeHtml(avatar)}" width="96" height="96" alt="" referrerpolicy="no-referrer">`
    : `<span class="av" aria-hidden="true">${escapeHtml(initials(model.title))}</span>`;
  const subtitle = model.subtitle ? `<p class="sub">${escapeHtml(model.subtitle)}</p>` : '';
  const badge = sample ? `<span class="badge">${T.sampleBadge}</span>` : '';
  const radios = ['all', ...chipKeys]
    .map((k, i) => `<input class="r" type="radio" name="c" id="c-${k}"${i === 0 ? ' checked' : ''}>`)
    .join('');
  const labels = [{ key: 'all', label: T.all }, ...chips]
    .map((c) => `<label for="c-${c.key}">${escapeHtml(c.label)}</label>`)
    .join('');
  const chipsHtml = chips.length ? `${radios}<nav class="chips" aria-label="${T.filterLabel}">${labels}</nav>` : '';
  const set = new Set(chipKeys);
  const grid = `<ul class="grid">${offers.map((o) => offerCard(o, set, opts.mediaOrigin)).join('')}</ul>`;
  const bodyClass = opts.viewport === 'mobile' ? ' class="vm"' : opts.viewport === 'desktop' ? ' class="vd"' : '';

  const html = `<!doctype html><html lang="pt-BR"><head>${head}</head><body${bodyClass}><main>${coverHtml}<header>${avatarHtml}<h1>${title}</h1>${subtitle}${badge}</header>${chipsHtml}${grid}</main><footer>${T.madeWith} ${escapeHtml(APP_NAME)}</footer></body></html>`;
  return { html, styleHash: sha256(css) };
}

/** CSP da vitrine, no molde de `publicPageCsp`: sem script, estilo só pelo hash, imagem só das origens. */
export function storefrontPageCsp(input: {
  styleHash: string;
  mediaOrigin: string | null;
  assetBaseUrl: string | null;
}): string {
  const img = [httpsOrigin(input.assetBaseUrl), httpsOrigin(input.mediaOrigin)].filter((o): o is string => !!o);
  return [
    "default-src 'none'",
    `style-src '${input.styleHash}'`,
    `img-src ${img.length ? [...new Set(img)].join(' ') : "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** "Em breve": página ativa sem nenhuma oferta publicada (200). Layout do rodízio. */
export function storefrontComingSoonPage(title: string): RenderedStorefrontPage {
  const html = renderPublicPage({
    title,
    heading: T.comingSoonHeading,
    description: T.comingSoon,
    bodyHtml: `<p>${T.comingSoon}</p>`,
  });
  return { html, styleHash: styleHashOf(html) };
}

/** Página pausada pelo plano (200). Layout do rodízio. */
export function storefrontPausedPage(title: string): RenderedStorefrontPage {
  const html = renderPublicPage({ title, heading: T.pausedHeading, description: T.paused, bodyHtml: `<p>${T.paused}</p>` });
  return { html, styleHash: styleHashOf(html) };
}
