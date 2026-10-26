import { logger } from '../../../../shared/logger/logger';
import { detectMarketplace, isSupportedProductUrl } from '../../domain/services/detectMarketplace';
import { parseProductPage, type ProductPageData } from '../../domain/services/parseProductPage';
import type { IProductPageReader, ReadProductPageInput } from '../../domain/contracts/IProductPageReader';

const log = logger.child({ module: 'HttpProductPageReader' });
const TIMEOUT_MS = 8_000;
const MAX_HOPS = 5;
const MAX_BYTES = 2 * 1024 * 1024;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
/** Caminhos de produto do ML que recebem o cookie `ssid`: `/MLB-…`, `[/slug]/p/MLB…`, `[/slug]/up/MLBU…`, `/social/…`. */
const ML_PRODUCT_PATH = /^\/(?:MLB-?\d|(?:[^/]+\/)?p\/MLB\d|(?:[^/]+\/)?up\/MLBU\d|social\/[^/])/i;

/**
 * Cookie `ssid` só em página de produto do ML (`*.mercadolivre.com.br`), conferido a cada salto:
 * home, login, busca ou qualquer outro caminho seguem sem cookie.
 */
export function sendsMlCookie(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === 'produto.mercadolivre.com.br') return true;
  if (host !== 'mercadolivre.com.br' && !host.endsWith('.mercadolivre.com.br')) return false;
  return ML_PRODUCT_PATH.test(url.pathname);
}

/** Token de cookie sem `;`, `,`, espaço ou controle — senão injetaria outro cookie. */
function safeCookieValue(token: string | null | undefined): string | null {
  return token && /^[A-Za-z0-9._~%+/=-]{1,4096}$/.test(token) ? token : null;
}

/**
 * Lê a página do produto (GEN-03). Mesma barreira de SSRF do expander: allowlist de
 * marketplace, `redirect: 'manual'` revalidando cada salto, 8 s para a cadeia inteira, corpo
 * cortado em 2 MB no stream, só `text/html`. Log só com host e path: nunca header, cookie ou query.
 */
export class HttpProductPageReader implements IProductPageReader {
  async read(input: ReadProductPageInput): Promise<ProductPageData | null> {
    const provider = detectMarketplace(input.url);
    if (!provider || !isSupportedProductUrl(input.url)) return null;
    const cookie = safeCookieValue(input.mercadoLivreSessionToken);
    const signal = AbortSignal.timeout(TIMEOUT_MS);

    let current = input.url;
    try {
      for (let hop = 0; ; hop++) {
        const headers: Record<string, string> = {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9',
        };
        if (cookie && sendsMlCookie(current)) headers.Cookie = `ssid=${cookie}`;
        const res = await fetch(current, { method: 'GET', redirect: 'manual', signal, headers });

        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location) {
          await res.body?.cancel().catch(() => undefined);
          if (hop >= MAX_HOPS) return this.fail(current, 'too_many_redirects');
          let next: URL;
          try {
            next = new URL(location, current);
          } catch {
            return this.fail(current, 'bad_location');
          }
          // Revalida antes de requisitar: salto para fora da allowlist nunca é buscado
          if (!isSupportedProductUrl(next)) return this.fail(current, 'redirect_blocked');
          current = next;
          continue;
        }

        const type = (res.headers.get('content-type') ?? '').toLowerCase();
        if (!res.ok || !type.includes('text/html') || !res.body) {
          await res.body?.cancel().catch(() => undefined);
          return this.fail(current, `status_${res.status}`);
        }
        const html = await readLimited(res.body);
        return parseProductPage(detectMarketplace(current) ?? provider, html);
      }
    } catch (err) {
      return this.fail(current, (err as Error)?.name ?? 'error');
    }
  }

  private fail(url: URL, reason: string): null {
    log.warn({ host: url.hostname, path: url.pathname, reason }, 'Página do produto não lida');
    return null;
  }
}

/** Lê no máximo MAX_BYTES e cancela o resto: título, foto e preço ficam no começo da página. */
async function readLimited(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = MAX_BYTES - total;
    chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
    total += Math.min(value.byteLength, room);
    if (total >= MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}
