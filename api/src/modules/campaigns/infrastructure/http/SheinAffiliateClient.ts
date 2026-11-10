import { logger } from '../../../../shared/logger/logger';
import {
  AffiliateApiUnavailableError,
  AffiliateCredentialRejectedError,
} from '../../../../shared/errors/internal/OfferErrors';
import { parsePriceToCents } from '../../domain/services/parseProductPage';
import type {
  ISheinAffiliateClient,
  SheinProductShare,
  SheinSession,
} from '../../domain/contracts/ISheinAffiliateClient';
import { USER_AGENT } from './HttpShortLinkExpander';

const log = logger.child({ module: 'SheinAffiliateClient' });
// URL fixa: nada vem de entrada (sem SSRF).
const ENDPOINT = 'https://m.shein.com/br/affiliate/api/goods/recommend/detailNew';
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 256 * 1024;
const PROVIDER = 'SHEIN';
// Mesmo limite do parseProductRef: acima de 15 dígitos `Number()` perderia precisão
const DIGITS = /^\d{4,12}$/;
const SHARE_HOST = 'onelink.shein.com';
const CODE_OK = '0';
const CODE_NOT_LOGGED = '100105';

class BodyTooLargeError extends Error {}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function toHttps(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.protocol = 'https:';
    return u.toString();
  } catch {
    return null;
  }
}

function shareUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    const clean = u.protocol === 'https:' && u.hostname.toLowerCase() === SHARE_HOST && !u.username && !u.password && !u.port;
    return clean ? u.toString() : null;
  } catch {
    return null;
  }
}

/** salesPrice vem em reais (29.99) → centavos. */
function salesCents(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim()) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** Mapper puro de `info`; null quando não há shareLink válido. */
export function mapSheinInfo(info: unknown): SheinProductShare | null {
  if (!info || typeof info !== 'object') return null;
  const i = info as Record<string, unknown>;
  const affiliateUrl = shareUrl(i.shareLink);
  if (!affiliateUrl) return null;
  const g = (i.goodsBasicInfo && typeof i.goodsBasicInfo === 'object' ? i.goodsBasicInfo : {}) as Record<
    string,
    unknown
  >;
  const name = str(g.goodsName);
  const priceCents = salesCents(g.salesPrice);
  const retail = typeof g.retailPrice === 'string' ? parsePriceToCents(g.retailPrice) : null;
  const originalPriceCents = retail !== null && (priceCents === null || retail > priceCents) ? retail : null;
  return {
    affiliateUrl,
    title: name ? name.replace(/\s+/g, ' ') : null,
    priceCents,
    originalPriceCents,
    imageUrl: toHttps(g.mainImageOfOriginImage) ?? toHttps(g.mainImage),
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

export class SheinAffiliateClient implements ISheinAffiliateClient {
  /** Nunca loga token, memberId, corpo ou URL: só status/código. */
  async getProductShare(session: SheinSession, goodsId: string): Promise<SheinProductShare | null> {
    if (!DIGITS.test(goodsId)) return null;
    const body = JSON.stringify({ language: 'pt-br', playId: 5, goodsId: Number(goodsId), uid: session.memberId });

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          token: session.token,
          siteuid: 'mbr',
          'content-type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      log.warn({ reason: (err as Error)?.name }, 'Shein API sem resposta');
      throw new AffiliateApiUnavailableError(PROVIDER);
    }

    // 401, ou 403 com o código de sessão inválida da Shein (observado na sonda), pausam a loja. 403 sem esse
    // código pode ser bloqueio de WAF/anti-bot do IP: não é culpa da credencial → indisponível
    if (res.status === 401) {
      await res.body?.cancel().catch(() => undefined);
      log.warn({ status: res.status }, 'Shein recusou a sessão');
      throw new AffiliateCredentialRejectedError(PROVIDER);
    }
    if (res.status === 403) {
      let forbiddenCode: string | null = null;
      try {
        const j = JSON.parse(await readLimited(res)) as { code?: unknown };
        forbiddenCode = j && j.code !== undefined && j.code !== null ? String(j.code) : null;
      } catch {
        forbiddenCode = null;
      }
      log.warn({ status: res.status, code: forbiddenCode }, forbiddenCode === CODE_NOT_LOGGED ? 'Shein recusou a sessão' : 'Shein API bloqueou');
      if (forbiddenCode === CODE_NOT_LOGGED) throw new AffiliateCredentialRejectedError(PROVIDER);
      throw new AffiliateApiUnavailableError(PROVIDER);
    }
    if (res.status >= 300 || res.type === 'opaqueredirect') {
      await res.body?.cancel().catch(() => undefined);
      log.warn({ status: res.status }, 'Shein API falhou');
      throw new AffiliateApiUnavailableError(PROVIDER);
    }

    let json: { code?: unknown; info?: unknown };
    try {
      json = JSON.parse(await readLimited(res)) as typeof json;
      if (!json || typeof json !== 'object') throw new Error('not object');
    } catch (err) {
      log.warn({ status: res.status, reason: err instanceof BodyTooLargeError ? 'too_large' : 'invalid_json' }, 'Shein API resposta ilegível');
      throw new AffiliateApiUnavailableError(PROVIDER);
    }

    const code = json.code === undefined || json.code === null ? null : String(json.code);
    if (code === CODE_NOT_LOGGED) {
      log.warn({ code }, 'Shein recusou a sessão');
      throw new AffiliateCredentialRejectedError(PROVIDER);
    }
    if (code !== CODE_OK) {
      log.warn({ code }, 'Shein API devolveu código inesperado');
      return null;
    }
    const share = mapSheinInfo(json.info);
    if (!share) log.warn({ code }, 'Shein sem shareLink válido');
    return share;
  }
}
