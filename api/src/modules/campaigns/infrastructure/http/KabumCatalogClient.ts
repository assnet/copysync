import { logger } from '../../../../shared/logger/logger';
import { AffiliateApiUnavailableError } from '../../../../shared/errors/internal/OfferErrors';
import type { IKabumCatalogClient, KabumProduct } from '../../domain/contracts/IKabumCatalogClient';
import { USER_AGENT } from './HttpShortLinkExpander';

const log = logger.child({ module: 'KabumCatalogClient' });

// URL fixa: só o id (dígitos) vem de entrada (sem SSRF). Resposta JSON:API `{ type, id, attributes }`.
export const KABUM_CATALOG_PRODUCT_URL = 'https://servicespub.prod.api.aws.grupokabum.com.br/catalog/v2/products';
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 256 * 1024;
const PROVIDER = 'KABUM';
const PRODUCT_ID = /^\d{1,12}$/;
/** Observado: images.kabum.com.br (fotos) e images4.kabum.com.br (logos). */
export const KABUM_IMAGE_HOST = 'kabum.com.br';
const PHOTO_SIZES = ['gg', 'g', 'm', 'p'] as const;

class BodyTooLargeError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** Reais (número ou texto "169.99") → centavos. `toFixed(6)` tira o resíduo binário de ×100 antes de arredondar. ≤ 0 → null. */
export function reaisToCents(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(Number((n * 100).toFixed(6)));
}

/**
 * Oferta ativa (campos reais de `offer`, epoch em segundos): `starts_at` ≤ agora < `ends_at`,
 * `quantity_available` > 0, `price_with_discount` válido e não exclusiva de usuário logado
 * (`is_logged_user_exclusive`: o comprador do link pode não estar logado).
 */
export function activeOfferPriceCents(offer: unknown, nowMs: number): number | null {
  if (!isObj(offer)) return null;
  const now = nowMs / 1000;
  const { starts_at: start, ends_at: end, quantity_available: qty } = offer;
  if (typeof end !== 'number' || !(end > now)) return null;
  if (typeof start === 'number' && start > now) return null;
  if (typeof qty !== 'number' || !(qty > 0)) return null;
  if (offer.is_logged_user_exclusive === true) return null;
  return reaisToCents(offer.price_with_discount);
}

function imageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const s = raw.trim();
    const u = new URL(s.startsWith('//') ? `https:${s}` : s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (host !== KABUM_IMAGE_HOST && !host.endsWith(`.${KABUM_IMAGE_HOST}`)) return null;
    if (u.username || u.password || u.port) return null;
    u.protocol = 'https:';
    return u.toString();
  } catch {
    return null;
  }
}

/** `images[0]` (maior, "_original"/"_gg"); senão a primeira de `photos.gg|g|m|p`. */
function firstImage(a: Obj): string | null {
  const candidates: unknown[] = [];
  if (Array.isArray(a.images)) candidates.push(a.images[0]);
  if (isObj(a.photos)) {
    for (const size of PHOTO_SIZES) {
      const list = a.photos[size];
      if (Array.isArray(list)) candidates.push(list[0]);
    }
  }
  for (const c of candidates) {
    const url = imageUrl(c);
    if (url) return url;
  }
  return null;
}

/** `attributes` → produto; null quando indisponível ou sem título/preço. */
export function mapKabumProduct(a: Obj, nowMs: number): KabumProduct | null {
  if (a.available !== true) return null;
  const title = typeof a.title === 'string' ? a.title.replace(/\s+/g, ' ').trim() : '';
  const priceCents =
    activeOfferPriceCents(a.offer, nowMs) ?? reaisToCents(a.price_with_discount) ?? reaisToCents(a.price);
  if (!title || priceCents === null) return null;
  const old = reaisToCents(a.old_price);
  return {
    title,
    priceCents,
    originalPriceCents: old !== null && old > priceCents ? old : null,
    imageUrl: firstImage(a),
    available: true,
  };
}

/** Lê no máximo MAX_BYTES; acima disso a resposta é tratada como indisponível. */
async function readLimited(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

function unavailable(data: Obj, msg: string): never {
  log.warn(data, msg);
  throw new AffiliateApiUnavailableError(PROVIDER);
}

export class KabumCatalogClient implements IKabumCatalogClient {
  constructor(private readonly now: () => number = Date.now) {}

  /** Loga só status e motivo; nunca corpo nem URL. */
  async getProduct(productId: string): Promise<KabumProduct | null> {
    if (typeof productId !== 'string' || !PRODUCT_ID.test(productId)) return null;

    let res: Response;
    try {
      res = await fetch(`${KABUM_CATALOG_PRODUCT_URL}/${productId}`, {
        method: 'GET',
        headers: { accept: 'application/json', 'User-Agent': USER_AGENT },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      return unavailable({ reason: (err as Error)?.name }, 'Kabum catálogo sem resposta');
    }

    if (res.status === 404) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    if (res.status !== 200 || res.type === 'opaqueredirect') {
      await res.body?.cancel().catch(() => undefined);
      return unavailable({ status: res.status }, 'Kabum catálogo falhou');
    }

    let json: unknown;
    try {
      json = JSON.parse(await readLimited(res));
    } catch (err) {
      return unavailable(
        { reason: err instanceof BodyTooLargeError ? 'too_large' : 'invalid_json' },
        'Kabum catálogo resposta ilegível',
      );
    }
    if (!isObj(json) || !isObj(json.attributes)) {
      return unavailable({ reason: 'unexpected_shape' }, 'Kabum catálogo fora do formato');
    }
    const product = mapKabumProduct(json.attributes, this.now());
    if (!product) log.info({ available: json.attributes.available === true }, 'Kabum produto indisponível ou incompleto');
    return product;
  }
}
