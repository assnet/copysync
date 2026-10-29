import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';

/** Dados que dá para tirar do HTML da página do produto. Preços em centavos (BRL). */
export interface ProductPageData {
  title: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  /** Id do produto achado na página (ML social: primeiro `"product_id":"MLB…"`). */
  productRef: string | null;
}

const TITLE_MAX = 300;
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Entidades HTML básicas + numéricas. */
export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

function clean(text: string | null | undefined): string | null {
  if (!text) return null;
  const out = decodeHtmlEntities(text.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  return out ? out.slice(0, TITLE_MAX) : null;
}

// Nomes de site que a loja põe no `<title>`/`og:title` quando a página não é de produto
// (bloqueio, perfil, erro). Gravar isso como título seria um título falso.
const SITE_NAMES = new Set([
  'mercado livre', 'mercado libre', 'mercadolivre', 'mercadolibre', 'mercado livre brasil',
  'amazon', 'amazon.com', 'amazon.com.br', 'amazon brasil', 'amazon.com.br amazon',
  'shopee', 'shopee brasil', 'shopee brazil', 'shopee.com.br', 'brasil', 'brazil',
]);

/** Título que é só o nome do site, inteiro ou em pedaços separados por ` | `, ` - `, `:`, `–`, `—`. */
export function isGenericSiteTitle(title: string): boolean {
  const norm = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const parts = norm.split(/\s*[|:–—]\s*|\s+-\s+/).filter(Boolean);
  return parts.length > 0 && parts.every((part) => SITE_NAMES.has(part));
}

/** Título limpo, ou null se vazio ou genérico (só o nome do site). */
function productTitle(text: string | null | undefined): string | null {
  const out = clean(text);
  return out && !isGenericSiteTitle(out) ? out : null;
}

/** `<meta property|name="key" content="…">` em qualquer ordem de atributos. */
function meta(html: string, key: string): string | null {
  const re = /<meta\b[^>]*>/gi;
  for (const tag of html.match(re) ?? []) {
    const name = /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (name?.toLowerCase() !== key) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    const value = content?.[1] ?? content?.[2];
    if (value?.trim()) return decodeHtmlEntities(value.trim());
  }
  return null;
}

/**
 * Preço em centavos: aceita `123.45`, `123,45`, `1.234,56`, `1,234.56`, `R$ 1.234`. Separador
 * decimal = o último `.`/`,` seguido de 1–2 dígitos no fim.
 */
export function parsePriceToCents(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) : null;
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const m = /^(.*?)[.,](\d{1,2})$/.exec(s);
  const intPart = (m ? m[1] : s).replace(/[.,]/g, '');
  const cents = m ? m[2].padEnd(2, '0') : '00';
  const n = Number(`${intPart || '0'}.${cents}`);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

type Json = unknown;

function asArray(v: Json): Json[] {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

function isProduct(node: Record<string, Json>): boolean {
  return asArray(node['@type']).some((t) => typeof t === 'string' && t.toLowerCase() === 'product');
}

/** Primeiro nó `Product` em JSON-LD (objeto, array ou `@graph`). */
function findJsonLdProduct(html: string): Record<string, Json> | null {
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let parsed: Json;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const queue = asArray(parsed);
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;
      const obj = node as Record<string, Json>;
      if (isProduct(obj)) return obj;
      queue.push(...asArray(obj['@graph']));
    }
  }
  return null;
}

function jsonLdData(product: Record<string, Json> | null): Partial<ProductPageData> {
  if (!product) return {};
  const offers = asArray(product.offers)[0] as Record<string, Json> | undefined;
  const price = parsePriceToCents(offers?.price ?? offers?.lowPrice ?? null);
  const high = parsePriceToCents(offers?.highPrice ?? null);
  const image = asArray(product.image)[0];
  const imageUrl =
    typeof image === 'string' ? image : image && typeof image === 'object' ? (image as Record<string, Json>).url : null;
  return {
    title: typeof product.name === 'string' ? productTitle(product.name) : null,
    imageUrl: typeof imageUrl === 'string' ? imageUrl : null,
    priceCents: price,
    originalPriceCents: high != null && price != null && high > price ? high : null,
  };
}

/** Bloco `andes-money-amount` do ML: fração (`1.234`) + centavos opcionais. */
function mercadoLivrePrices(html: string): { current: number | null; previous: number | null } {
  let current: number | null = null;
  let previous: number | null = null;
  const re = /<(\w+)\b[^>]*class\s*=\s*"([^"]*\bandes-money-amount(?![_\w-]*__)[^"]*)"[^>]*>/gi;
  for (const m of html.matchAll(re)) {
    const classes = m[2];
    if (!/(^|\s)andes-money-amount(\s|$|--)/.test(classes)) continue;
    const tail = html.slice(m.index! + m[0].length, m.index! + m[0].length + 800);
    const fraction = /andes-money-amount__fraction[^"]*"[^>]*>([\d.]+)</.exec(tail)?.[1];
    if (!fraction) continue;
    const cents = /andes-money-amount__cents[^"]*"[^>]*>(\d{1,2})</.exec(tail.slice(0, 400))?.[1];
    const value = parsePriceToCents(`${fraction.replace(/\./g, '')},${cents ?? '00'}`);
    const isPrevious = m[1].toLowerCase() === 's' || classes.includes('andes-money-amount--previous');
    if (isPrevious) previous ??= value;
    else current ??= value;
    if (current != null && previous != null) break;
  }
  return { current, previous };
}

/** Amazon: `#productTitle`, primeiro `a-offscreen`, preço riscado em `a-text-price`, foto `data-old-hires`. */
function amazonData(html: string): Partial<ProductPageData> {
  const title = productTitle(/<span\b[^>]*id\s*=\s*"productTitle"[^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1]);
  const price = parsePriceToCents(clean(/class\s*=\s*"a-offscreen"[^>]*>([^<]+)</i.exec(html)?.[1]));
  const strike = /class\s*=\s*"a-price a-text-price[^"]*"[\s\S]{0,300}?class\s*=\s*"a-offscreen"[^>]*>([^<]+)</i.exec(html)?.[1];
  const original = parsePriceToCents(clean(strike));
  const image =
    /data-old-hires\s*=\s*"(https:[^"]+)"/i.exec(html)?.[1] ?? /"hiRes"\s*:\s*"(https:[^"]+)"/i.exec(html)?.[1] ?? null;
  return {
    title,
    priceCents: price,
    originalPriceCents: original != null && price != null && original > price ? original : null,
    imageUrl: image,
  };
}

/** Primeiro objeto JSON que começa em `start` (chaves balanceadas, strings respeitadas); null se inválido. */
function sliceJsonObject(text: string, start: number, maxLen = 60_000): string | null {
  if (text[start] !== '{') return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length && i - start < maxLen; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * Vitrine "social" do ML (`/social/<etiqueta>?…&ref=…`): a página é um perfil, não um produto, e os
 * `og:*`/JSON-LD falam do perfil. O produto está no 1º `polycard` (`metadata.product_id`,
 * `components[type=title|price]`, `pictures.pictures[0].id` + `picture_template` do contexto).
 * Foto: template com `{square}`→`NQ`, `{2x}`→`_2X`, `{size}`→`F` (formato padrão do ML).
 */
export function parseMercadoLivreSocialPage(html: string): ProductPageData {
  const empty: ProductPageData = { title: null, imageUrl: null, priceCents: null, originalPriceCents: null, productRef: null };
  const list = html.indexOf('"polycards":[');
  if (list < 0) return empty;
  const raw = sliceJsonObject(html, list + '"polycards":['.length);
  if (!raw) return empty;
  let card: Record<string, Json>;
  try {
    card = JSON.parse(raw) as Record<string, Json>;
  } catch {
    return empty;
  }
  const meta = (card.metadata ?? {}) as Record<string, Json>;
  const components = asArray(card.components) as Record<string, Json>[];
  const byType = (t: string) => components.find((c) => c?.type === t) ?? null;
  const titleNode = byType('title')?.title as Record<string, Json> | undefined;
  const priceNode = byType('price')?.price as Record<string, Json> | undefined;
  const current = parsePriceToCents((priceNode?.current_price as Record<string, Json> | undefined)?.value ?? null);
  const previous = parsePriceToCents((priceNode?.previous_price as Record<string, Json> | undefined)?.value ?? null);
  const pictures = (card.pictures as Record<string, Json> | undefined)?.pictures;
  const pictureId = (asArray(pictures)[0] as Record<string, Json> | undefined)?.id;
  // O template fica no `polycard_context`, antes da lista (o 1º da página serve para todos os cards),
  // como string JSON (`\u002F` no lugar de `/`): decodificar antes de usar
  const rawTemplate = /"picture_template"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(html.slice(0, list))?.[1];
  let template: string | null = null;
  try {
    template = rawTemplate ? (JSON.parse(`"${rawTemplate}"`) as string) : null;
  } catch {
    template = null;
  }
  const imageUrl = typeof pictureId === 'string' && template && /^[A-Za-z0-9_-]+$/.test(pictureId)
    ? template.replace('{square}', 'NQ').replace('{2x}', '_2X').replace('{id}', pictureId).replace('{size}', 'F').replace('{sanitized_title}', '')
    : null;
  const productId = typeof meta.product_id === 'string' && /^MLB\d+$/i.test(meta.product_id) ? meta.product_id.toUpperCase() : null;
  return {
    title: typeof titleNode?.text === 'string' ? productTitle(titleNode.text) : null,
    imageUrl: imageUrl?.startsWith('https://http2.mlstatic.com/') ? imageUrl : null,
    priceCents: current,
    originalPriceCents: previous != null && current != null && previous > current ? previous : null,
    productRef: productId,
  };
}

/**
 * Extrai título, foto e preços do HTML. Ordem: `og:*` → JSON-LD `Product` → `product:price:amount`
 * → marcação própria da loja (ML `andes-money-amount`, Amazon) → `<title>`. Campo ausente = null.
 */
export function parseProductPage(provider: AffiliateProvider, html: string): ProductPageData {
  const ld = jsonLdData(findJsonLdProduct(html));
  const store = provider === 'AMAZON' ? amazonData(html) : {};
  const ml = provider === 'MERCADO_LIVRE' ? mercadoLivrePrices(html) : { current: null, previous: null };

  const title =
    productTitle(meta(html, 'og:title')) ?? ld.title ?? store.title ?? productTitle(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]);
  const imageUrl = meta(html, 'og:image') ?? ld.imageUrl ?? store.imageUrl ?? null;
  const priceCents =
    ld.priceCents ?? parsePriceToCents(meta(html, 'product:price:amount')) ??
    ml.current ??
    parsePriceToCents(meta(html, 'price')) ?? store.priceCents ?? null;
  let originalPriceCents = ld.originalPriceCents ?? ml.previous ?? store.originalPriceCents ?? null;
  if (originalPriceCents != null && (priceCents == null || originalPriceCents <= priceCents)) originalPriceCents = null;

  const productRef =
    provider === 'MERCADO_LIVRE' ? (/"product_id"\s*:\s*"(MLB\d+)"/i.exec(html)?.[1]?.toUpperCase() ?? null) : null;

  return { title, imageUrl: imageUrl?.startsWith('https://') ? imageUrl : null, priceCents, originalPriceCents, productRef };
}
