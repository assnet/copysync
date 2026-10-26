import { createHash } from 'node:crypto';
import { logger } from '../../../../shared/logger/logger';
import {
  AffiliateApiAccessDeniedError,
  AffiliateApiRateLimitedError,
  AffiliateApiUnavailableError,
  AffiliateCredentialRejectedError,
  OfferUrlUnsupportedError,
} from '../../../../shared/errors/internal/OfferErrors';
import type {
  IShopeeAffiliateClient,
  ShopeeCredential,
  ShopeeProduct,
  ShopeeProductRef,
} from '../../domain/contracts/IShopeeAffiliateClient';

const log = logger.child({ module: 'ShopeeAffiliateClient' });
const ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';
const TIMEOUT_MS = 8_000;
const PROVIDER = 'SHOPEE';
const DIGITS = /^\d{1,20}$/;

// Códigos da Open API. 10035 e 10020 vêm da doc; 10031–10034 (assinatura/auth) NÃO verificados.
const ACCESS_DENIED = new Set([10035]);
const CREDENTIAL_REJECTED = new Set([10020, 10031, 10032, 10033, 10034]);
const RATE_LIMITED = new Set([10030]);

type GraphqlError = { code?: unknown; extensions?: { code?: unknown } };
type GraphqlResponse = { data?: Record<string, unknown> | null; errors?: GraphqlError[] };

/** Assinatura: sha256 hex de appId + timestamp + corpo exato enviado + secret. */
export function signShopeeRequest(appId: string, ts: number, body: string, secret: string): string {
  return createHash('sha256').update(`${appId}${ts}${body}${secret}`).digest('hex');
}

/** Preço em BRL decimal (string ou número; formato não verificado) → centavos. */
export function parsePriceCents(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Mapper tolerante: campos de productOfferV2 não verificados; ausência vira null. */
export function mapShopeeNode(node: Record<string, unknown>): ShopeeProduct | null {
  const title = str(node.productName);
  if (!title) return null;
  const priceCents = parsePriceCents(node.priceMin) ?? parsePriceCents(node.priceMax);
  // priceDiscountRate em % inteiro (não verificado).
  const rate = Number(node.priceDiscountRate);
  const originalPriceCents =
    priceCents !== null && Number.isFinite(rate) && rate > 0 && rate < 100
      ? Math.round(priceCents / (1 - rate / 100))
      : null;
  return {
    title,
    imageUrl: str(node.imageUrl),
    priceCents,
    originalPriceCents,
    offerLink: str(node.offerLink),
  };
}

function errorCode(e: GraphqlError | undefined): number | null {
  const raw = e?.extensions?.code ?? e?.code;
  const n = Number(raw);
  return raw === undefined || raw === null || !Number.isFinite(n) ? null : n;
}

function mapErrorCode(code: number | null): Error {
  if (code !== null && ACCESS_DENIED.has(code)) return new AffiliateApiAccessDeniedError(PROVIDER);
  if (code !== null && CREDENTIAL_REJECTED.has(code)) return new AffiliateCredentialRejectedError(PROVIDER);
  if (code !== null && RATE_LIMITED.has(code)) return new AffiliateApiRateLimitedError(PROVIDER);
  return new AffiliateApiUnavailableError(PROVIDER);
}

export class ShopeeAffiliateClient implements IShopeeAffiliateClient {
  async getProduct(cred: ShopeeCredential, ref: ShopeeProductRef): Promise<ShopeeProduct | null> {
    if (!DIGITS.test(ref.shopId) || !DIGITS.test(ref.itemId)) {
      throw new OfferUrlUnsupportedError('Invalid product reference');
    }
    // Ids só dígitos: literal numérico sem risco de injeção.
    const query =
      `{ productOfferV2(shopId: ${ref.shopId}, itemId: ${ref.itemId}, limit: 1) ` +
      '{ nodes { itemId shopId productName imageUrl priceMin priceMax priceDiscountRate offerLink productLink } } }';
    const data = await this.request(cred, query);
    const conn = data.productOfferV2 as { nodes?: unknown } | null | undefined;
    const nodes = Array.isArray(conn?.nodes) ? conn.nodes : [];
    const first = nodes[0];
    return first && typeof first === 'object' ? mapShopeeNode(first as Record<string, unknown>) : null;
  }

  async generateShortLink(cred: ShopeeCredential, originUrl: string, subIds: string[] = []): Promise<string> {
    // JSON.stringify gera literal de string/lista GraphQL válido e escapado.
    const subs = subIds.length ? `, subIds: ${JSON.stringify(subIds)}` : '';
    const query =
      `mutation { generateShortLink(input: { originUrl: ${JSON.stringify(originUrl)}${subs} }) { shortLink } }`;
    const data = await this.request(cred, query);
    const link = str((data.generateShortLink as { shortLink?: unknown } | null | undefined)?.shortLink);
    if (!link) {
      log.warn('generateShortLink sem shortLink');
      throw new AffiliateApiUnavailableError(PROVIDER);
    }
    return link;
  }

  /** Nunca loga corpo, header, assinatura ou segredo: só status/código. */
  private async request(cred: ShopeeCredential, query: string): Promise<Record<string, unknown>> {
    const body = JSON.stringify({ query });
    const ts = Math.floor(Date.now() / 1000);
    const signature = signShopeeRequest(cred.appId, ts, body, cred.secret);

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `SHA256 Credential=${cred.appId}, Timestamp=${ts}, Signature=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      log.warn({ reason: (err as Error)?.name }, 'Shopee API sem resposta');
      throw new AffiliateApiUnavailableError(PROVIDER);
    }

    if (res.status === 429) {
      log.warn({ status: 429 }, 'Shopee API rate limit');
      throw new AffiliateApiRateLimitedError(PROVIDER);
    }

    let json: GraphqlResponse;
    try {
      json = (await res.json()) as GraphqlResponse;
    } catch {
      log.warn({ status: res.status }, 'Shopee API resposta ilegível');
      throw new AffiliateApiUnavailableError(PROVIDER);
    }

    const errs = Array.isArray(json?.errors) ? json.errors : [];
    if (errs.length) {
      const code = errorCode(errs[0]);
      log.warn({ status: res.status, code }, 'Shopee API devolveu erro');
      throw mapErrorCode(code);
    }
    if (!res.ok || !json?.data || typeof json.data !== 'object') {
      log.warn({ status: res.status }, 'Shopee API falhou');
      throw new AffiliateApiUnavailableError(PROVIDER);
    }
    return json.data;
  }
}
