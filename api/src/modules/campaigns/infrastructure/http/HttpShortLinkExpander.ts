import { logger } from '../../../../shared/logger/logger';
import {
  AffiliateApiUnavailableError,
  OfferUrlUnsupportedError,
} from '../../../../shared/errors/internal/OfferErrors';
import { detectMarketplace, isSupportedProductUrl } from '../../domain/services/detectMarketplace';
import type { IShortLinkExpander } from '../../domain/contracts/IShortLinkExpander';
import { isShortLink } from '../../domain/services/isShortLink';

/** Reexportado: o teste e consumidores antigos importam daqui. */
export { isShortLink };

const log = logger.child({ module: 'HttpShortLinkExpander' });
const TIMEOUT_MS = 8_000;
const MAX_HOPS = 5;
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
/** Shein: o onelink responde 200 com HTML e a URL do produto em `<input id="url">`, sem redirect. */
const ONELINK_HOST = 'onelink.shein.com';
const ONELINK_MAX_BYTES = 32 * 1024;
const HTML_ENTITIES: Record<string, string> = { amp: '&', quot: '"', '#39': "'", '#x27': "'", lt: '<', gt: '>' };

export class HttpShortLinkExpander implements IShortLinkExpander {
  async expand(url: URL): Promise<URL> {
    if (!isSupportedProductUrl(url)) throw new OfferUrlUnsupportedError();
    if (!isShortLink(url)) return url;

    // Um único sinal: o timeout vale para a cadeia inteira de saltos.
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let current = url;
    for (let hop = 0; ; hop++) {
      const onelink = current.hostname.toLowerCase() === ONELINK_HOST;
      const { res, html } = onelink ? await this.requestOnelink(current, signal) : { res: await this.request(current, signal), html: null };
      // Onelink 2xx: a URL do `input` já é a final. Nunca buscar a página do produto (sem cookie cai em `/risk/challenge`)
      if (onelink && res.status >= 200 && res.status < 300) return onelinkTarget(html) ?? current;
      const location = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !location) return current;
      if (hop >= MAX_HOPS) throw new OfferUrlUnsupportedError('Too many redirects');

      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new OfferUrlUnsupportedError();
      }
      // Revalida antes de requisitar: redirect para host fora da allowlist nunca é buscado.
      if (!isSupportedProductUrl(next)) throw new OfferUrlUnsupportedError();
      // Salto para página Shein que não é o onelink: devolve sem buscar (sem cookie cai em `/risk/challenge`)
      if (detectMarketplace(next) === 'SHEIN' && next.hostname.toLowerCase() !== ONELINK_HOST) return next;
      current = next;
    }
  }

  private async request(url: URL, signal: AbortSignal): Promise<Response> {
    try {
      let res = await this.send(url, 'HEAD', signal);
      // Encurtador que só responde a GET (`link.amazon` dá 404 no HEAD): erro no HEAD → tenta GET
      if (res.status >= 400) res = await this.send(url, 'GET', signal);
      return res;
    } catch (err) {
      if (err instanceof OfferUrlUnsupportedError) throw err;
      log.warn({ host: url.hostname, reason: (err as Error)?.name }, 'Falha ao expandir link curto');
      throw new AffiliateApiUnavailableError(detectMarketplace(url) ?? 'UNKNOWN');
    }
  }

  /** Só GET (nunca HEAD); em 2xx o corpo é lido até 32 KiB, nos demais é cancelado. */
  private async requestOnelink(url: URL, signal: AbortSignal): Promise<{ res: Response; html: string | null }> {
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      });
      if (res.status < 200 || res.status >= 300 || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        return { res, html: null };
      }
      return { res, html: await readLimited(res.body, ONELINK_MAX_BYTES) };
    } catch (err) {
      log.warn({ host: url.hostname, reason: (err as Error)?.name }, 'Falha ao expandir link curto');
      throw new AffiliateApiUnavailableError(detectMarketplace(url) ?? 'UNKNOWN');
    }
  }

  private async send(url: URL, method: 'HEAD' | 'GET', signal: AbortSignal): Promise<Response> {
    const res = await fetch(url, {
      method,
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
    });
    // Libera o socket: o corpo nunca é lido.
    await res.body?.cancel().catch(() => undefined);
    return res;
  }
}

/**
 * URL do produto no `<input id="url" value="…">` do onelink (aspas simples ou duplas, qualquer
 * ordem de atributo), com entidades desfeitas. Sem `input` → null; destino fora da allowlist → recusa.
 */
export function onelinkTarget(html: string | null): URL | null {
  if (!html) return null;
  for (const [, attrs] of html.matchAll(/<input\b([^>]*)>/gi)) {
    if (!/(?:^|\s)id\s*=\s*(["'])url\1/i.test(attrs)) continue;
    const m = /(?:^|\s)value\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    if (!m) continue;
    const raw = (m[1] ?? m[2]).trim().replace(/&(amp|quot|#39|#x27|lt|gt);/gi, (e, k: string) => HTML_ENTITIES[k.toLowerCase()] ?? e);
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      throw new OfferUrlUnsupportedError();
    }
    if (!isSupportedProductUrl(target)) throw new OfferUrlUnsupportedError();
    return target;
  }
  return null;
}

/** Lê no máximo `max` bytes e cancela o resto. */
async function readLimited(body: ReadableStream<Uint8Array>, max: number): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = max - total;
    chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
    total += Math.min(value.byteLength, room);
    if (total >= max) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}
