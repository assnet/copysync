import { logger } from '../../../../shared/logger/logger';
import {
  AffiliateApiUnavailableError,
  OfferUrlUnsupportedError,
} from '../../../../shared/errors/internal/OfferErrors';
import { detectMarketplace, isSupportedProductUrl } from '../../domain/services/detectMarketplace';
import type { IShortLinkExpander } from '../../domain/contracts/IShortLinkExpander';

const log = logger.child({ module: 'HttpShortLinkExpander' });
const TIMEOUT_MS = 8_000;
const MAX_HOPS = 5;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SHORT_HOSTS = new Set(['s.shopee.com.br', 'shope.ee', 'amzn.to']);

/** Só link curto conhecido vai para a rede; o resto já é a URL do produto. */
export function isShortLink(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (SHORT_HOSTS.has(host)) return true;
  return host === 'mercadolivre.com' && (url.pathname.startsWith('/sec/') || url.pathname.startsWith('/social/'));
}

export class HttpShortLinkExpander implements IShortLinkExpander {
  async expand(url: URL): Promise<URL> {
    if (!isSupportedProductUrl(url)) throw new OfferUrlUnsupportedError();
    if (!isShortLink(url)) return url;

    // Um único sinal: o timeout vale para a cadeia inteira de saltos.
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let current = url;
    for (let hop = 0; ; hop++) {
      const res = await this.request(current, signal);
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
      current = next;
    }
  }

  private async request(url: URL, signal: AbortSignal): Promise<Response> {
    try {
      let res = await this.send(url, 'HEAD', signal);
      if (res.status === 405 || res.status === 501) res = await this.send(url, 'GET', signal);
      return res;
    } catch (err) {
      if (err instanceof OfferUrlUnsupportedError) throw err;
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
