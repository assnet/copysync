// Resposta de `POST /affiliate-program/api/hub/search` (hub de afiliados ML, observado 2026-11-13) → candidatos e
// categorias do Caçador. Puro: sem infra. Formato em docs/extensao-ml-endpoints.md, "Hub de afiliados — busca".
import type { HuntCandidate } from '../../hunter/HuntCandidate';
import type { HuntSourceCategory } from '../../hunter/HuntProvider';
import { MERCADO_LIVRE_PRODUCT_ID } from './mercadoLivreCapabilities';
import { estimateMercadoLivreCommissionPct } from './mercadoLivreCommissionTable';
import { parseSalesBucket } from './parseSalesBucket';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** Caractere de controle/separador de linha (palavra-chave, nome de categoria). */
export const ML_CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const CONTROL_ALL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
export const MERCADO_LIVRE_CATEGORY_ID = /^MLB\d{1,12}$/;
const CATEGORY_NAME_MAX = 80;
export const ML_ALL_CATEGORIES_NAME = 'Todas';
const IMAGE_HOST = 'mlstatic.com';
/** Id da foto no `pictures[].id` (ex.: `810731-MLA107960983825_032026`). */
const PICTURE_ID = /^[0-9A-Za-z_-]{5,80}$/;
/** Template observado em `polycard_context.picture_template`; usado se a resposta não trouxer. */
const DEFAULT_PICTURE_TEMPLATE = 'https://http2.mlstatic.com/D_{square}_NP{2x}_{id}-{size}{sanitized_title}.webp';
const COMMISSION_CHIP_ID = 'affiliates_commission_chip';

export interface MercadoLivreHubContext {
  /** `polycard_context.picture_template` (ou null). */
  pictureTemplate: string | null;
  pictureSquare: string | null;
  pictureSize: string | null;
  /** Categoria pedida na busca (o cartão não traz a sua): vai para `categoryId` e alimenta a estimativa. */
  categoryId: string | null;
}

export interface MercadoLivreHubPage {
  items: HuntCandidate[];
  hasNextPage: boolean;
  /** Cartões sem `metadata.id` válido. */
  dropped: number;
  /** Cartões sem chip de comissão e com categoria fora da tabela: comissão não avaliável, descartados. */
  noCommission: number;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const isTrue = (v: unknown): boolean => v === true || v === 'true';

function money(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** Componentes do cartão por `id` (fallback `type`). */
function componentsById(card: Obj): Map<string, Obj> {
  const out = new Map<string, Obj>();
  if (!Array.isArray(card.components)) return out;
  for (const c of card.components) {
    if (!isObj(c)) continue;
    const id = str(c.id) ?? str(c.type);
    if (id && !out.has(id)) out.set(id, c);
  }
  return out;
}

/** Texto com `{chave}` trocado por `values[].label.text` (formato "composite" do polycard). */
function renderTemplated(node: unknown): string {
  if (!isObj(node)) return '';
  const text = typeof node.text === 'string' ? node.text : '';
  const values = Array.isArray(node.values) ? node.values : [];
  return text.replace(/\{([a-z0-9_]+)\}/gi, (_, key: string) => {
    const v = values.find((x) => isObj(x) && x.key === key);
    const label = isObj(v) && isObj(v.label) ? v.label.text : undefined;
    return typeof label === 'string' ? label : '';
  });
}

/**
 * Chip "GANHOS 12%" (pill simples) ou "GANHOS EXTRAS" + `label` "20%" (composite). Percentual já inclui o extra.
 * null = chip ausente ou sem percentual legível.
 */
export function parseMercadoLivreCommissionChip(component: unknown): { pct: number; extra: boolean } | null {
  if (!isObj(component) || !isObj(component.chip)) return null;
  const chip = component.chip;
  const text = `${renderTemplated(chip.pill)} ${isObj(chip.label) && typeof chip.label.text === 'string' ? chip.label.text : ''}`;
  const m = /(\d{1,3}(?:[.,]\d{1,2})?)\s*%/.exec(text);
  if (!m) return null;
  const pct = Number(m[1]!.replace(',', '.'));
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return { pct, extra: /\bEXTRAS?\b/i.test(text) };
}

/** "Mais de 100 produtos vendidos" → 100; "Mais de 50mil" → 50000; fallback no rótulo "| +10mil vendidos". */
export function parseMercadoLivreSales(altText: unknown, label: unknown): number {
  const fromAlt = typeof altText === 'string' ? /mais de\s+([\d.,]+\s*(?:mil|mi|k|m)?)\s+produtos?\s+vendidos?/i.exec(altText) : null;
  if (fromAlt) return parseSalesBucket(fromAlt[1]!.replace(/\s+/g, ''));
  const fromLabel = typeof label === 'string' ? /\+\s*([\d.,]+\s*(?:mil|mi|k|m)?)\s+vendidos?/i.exec(label) : null;
  return fromLabel ? parseSalesBucket(fromLabel[1]!.replace(/\s+/g, '')) : 0;
}

function reviewParts(component: Obj | undefined): { rating: number | null; sales: number } {
  const rc = component && isObj(component.review_compacted) ? component.review_compacted : null;
  if (!rc) return { rating: null, sales: 0 };
  const values = Array.isArray(rc.values) ? rc.values : [];
  const labelOf = (key: string): string | null => {
    const v = values.find((x) => isObj(x) && x.key === key);
    return isObj(v) && isObj(v.label) && typeof v.label.text === 'string' ? v.label.text : null;
  };
  let rating: number | null = null;
  const r = labelOf('label');
  const n = r !== null ? Number(r.replace(',', '.')) : NaN;
  if (Number.isFinite(n)) rating = n;
  else if (typeof rc.alt_text === 'string') {
    const m = /classifica[cç][aã]o\s+(\d(?:[.,]\d+)?)\s+de\s+5/i.exec(rc.alt_text);
    if (m) rating = Number(m[1]!.replace(',', '.'));
  }
  return {
    rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
    sales: parseMercadoLivreSales(rc.alt_text, labelOf('label2')),
  };
}

/** Foto do template + id; só https em `*.mlstatic.com`, sem credencial/porta e sem placeholder sobrando. */
export function buildMercadoLivreImageUrl(card: Obj, ctx: MercadoLivreHubContext): string | null {
  const pics = isObj(card.pictures) ? card.pictures : null;
  const first = pics && Array.isArray(pics.pictures) ? pics.pictures[0] : null;
  const id = isObj(first) ? str(first.id) : null;
  if (!id || !PICTURE_ID.test(id)) return null;
  const square = (pics && str(pics.square)) ?? ctx.pictureSquare ?? 'Q';
  const size = ctx.pictureSize ?? 'AB';
  if (!/^[A-Z]{1,3}$/.test(square) || !/^[A-Z]{1,3}$/.test(size)) return null;
  const filled = (ctx.pictureTemplate ?? DEFAULT_PICTURE_TEMPLATE)
    .replace('{square}', square)
    .replace('{2x}', '_2X')
    .replace('{id}', id)
    .replace('{size}', size)
    .replace('{sanitized_title}', '');
  if (/[{}]/.test(filled)) return null;
  try {
    const u = new URL(filled);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    if (host !== IMAGE_HOST && !host.endsWith(`.${IMAGE_HOST}`)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

type CardResult = HuntCandidate | 'NO_ID' | 'NO_COMMISSION';

/**
 * Cartão `polycards[]` → candidato; null sem `metadata.id` `MLB\d+` válido ou sem comissão avaliável (sem chip e
 * categoria fora da tabela: nunca vira 0% como se fosse dado real).
 */
export function mapMercadoLivreHubCard(raw: unknown, ctx: MercadoLivreHubContext): HuntCandidate | null {
  const out = mapCard(raw, ctx);
  return typeof out === 'string' ? null : out;
}

function mapCard(raw: unknown, ctx: MercadoLivreHubContext): CardResult {
  if (!isObj(raw) || !isObj(raw.metadata)) return 'NO_ID';
  const productId = str(raw.metadata.id);
  if (!productId || !MERCADO_LIVRE_PRODUCT_ID.test(productId)) return 'NO_ID';

  const comps = componentsById(raw);
  const titleNode = comps.get('title')?.title;
  const titleText = isObj(titleNode) ? str(titleNode.text) : null;
  const title = titleText ? titleText.replace(CONTROL_ALL, ' ').replace(/\s+/g, ' ').trim() || null : null;

  const priceNode = comps.get('price')?.price;
  const current = isObj(priceNode) && isObj(priceNode.current_price) ? money(priceNode.current_price.value) : null;
  const previous = isObj(priceNode) && isObj(priceNode.previous_price) ? money(priceNode.previous_price.value) : null;
  const priceCents = current;
  const retailPriceCents = previous !== null && priceCents !== null && previous > priceCents ? previous : null;
  const discountPct =
    priceCents !== null && retailPriceCents !== null ? Math.round((1 - priceCents / retailPriceCents) * 100) : 0;

  // Com chip = real; sem chip, pela tabela da categoria = estimada; sem os dois = descartado
  const chip = parseMercadoLivreCommissionChip(comps.get(COMMISSION_CHIP_ID));
  const estimated = chip ? null : estimateMercadoLivreCommissionPct(ctx.categoryId);
  if (!chip && estimated === null) return 'NO_COMMISSION';
  const commissionPct = chip ? chip.pct : (estimated as number);
  const commissionEstimated = !chip;
  const extraFlag = isTrue(raw.metadata.extra_commission) || chip?.extra === true;
  const { rating, sales } = reviewParts(comps.get('review_compacted'));

  return {
    provider: 'MERCADO_LIVRE',
    productId,
    skc: null,
    activityId: null,
    title,
    imageUrl: buildMercadoLivreImageUrl(raw, ctx),
    priceCents,
    retailPriceCents,
    discountPct: Math.min(100, Math.max(0, discountPct)),
    commissionNewPct: commissionPct,
    commissionNewCents: priceCents !== null ? Math.round((priceCents * commissionPct) / 100) : 0,
    commissionReturningPct: 0,
    commissionReturningCents: 0,
    hasSecondaryCommission: false,
    extraFlag,
    // O extra já está no percentual do chip
    extraCommissionCents: 0,
    commissionEstimated,
    sales,
    reviews: 0,
    rating,
    rank: null,
    categoryId: ctx.categoryId,
    campaignEndsAt: null,
  };
}

function contextOf(json: Obj, categoryId: string | null): MercadoLivreHubContext {
  const model = isObj(json.polycard_client_model) ? json.polycard_client_model : null;
  const pc = model && isObj(model.polycard_context) ? model.polycard_context : null;
  return {
    pictureTemplate: pc ? str(pc.picture_template) : null,
    pictureSquare: pc ? str(pc.picture_square_default) : null,
    pictureSize: pc ? str(pc.picture_size_default) : null,
    categoryId,
  };
}

/** Página da busca; null = fora do formato (sem `polycard_client_model.polycards[]`). */
export function parseMercadoLivreHubPage(json: unknown, categoryId: string | null): MercadoLivreHubPage | null {
  if (!isObj(json) || !isObj(json.polycard_client_model)) return null;
  const cards = json.polycard_client_model.polycards;
  if (!Array.isArray(cards)) return null;
  const ctx = contextOf(json, categoryId);
  const items: HuntCandidate[] = [];
  let dropped = 0;
  let noCommission = 0;
  for (const raw of cards) {
    const c = mapCard(raw, ctx);
    if (c === 'NO_ID') dropped += 1;
    else if (c === 'NO_COMMISSION') noCommission += 1;
    else items.push(c);
  }
  const next = json.next_offset;
  return { items, hasNextPage: next !== undefined && next !== null, dropped, noCommission };
}

/** Filtro `category` da resposta → categorias com "Todas" (null) primeiro; null = `filters` fora do formato. */
export function parseMercadoLivreHubCategories(json: unknown): HuntSourceCategory[] | null {
  if (!isObj(json) || !Array.isArray(json.filters)) return null;
  const out: HuntSourceCategory[] = [{ categoryId: null, name: ML_ALL_CATEGORIES_NAME }];
  const filter = json.filters.find((f) => isObj(f) && f.id === 'category');
  const values = isObj(filter) && Array.isArray(filter.values) ? filter.values : [];
  const seen = new Set<string>();
  for (const v of values) {
    if (!isObj(v)) continue;
    const id = str(v.id);
    const name = typeof v.name === 'string' ? v.name.replace(/\s+/g, ' ').trim() : '';
    if (!id || !MERCADO_LIVRE_CATEGORY_ID.test(id) || seen.has(id)) continue;
    if (!name || name.length > CATEGORY_NAME_MAX || ML_CONTROL_CHARS.test(name)) continue;
    seen.add(id);
    out.push({ categoryId: id, name });
  }
  return out;
}
