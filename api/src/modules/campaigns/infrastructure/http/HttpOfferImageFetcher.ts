import { logger } from '../../../../shared/logger/logger';
import type { FetchedOfferImage, IOfferImageFetcher } from '../../domain/contracts/IOfferImageFetcher';

const log = logger.child({ module: 'HttpOfferImageFetcher' });
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 5 * 1024 * 1024;
const HOST_SUFFIXES = ['susercontent.com', 'shopee.com.br'];

/** https, sem porta/userinfo, host igual ou subdomínio de um sufixo permitido. */
export function isAllowedImageUrl(url: URL): boolean {
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

export class HttpOfferImageFetcher implements IOfferImageFetcher {
  async fetch(raw: string): Promise<FetchedOfferImage | null> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    // Log sem query string (pode carregar token de CDN).
    const where = { host: url.hostname, path: url.pathname };
    if (!isAllowedImageUrl(url)) {
      log.warn(where, 'Imagem fora da allowlist');
      return null;
    }

    let res: Response;
    try {
      res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      log.warn({ ...where, reason: (err as Error)?.name }, 'Falha ao baixar imagem');
      return null;
    }

    const mimeType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const length = Number(res.headers.get('content-length') ?? NaN);
    if (!res.ok || !mimeType.startsWith('image/') || (Number.isFinite(length) && length > MAX_BYTES) || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      log.warn({ ...where, status: res.status, mimeType }, 'Imagem recusada');
      return null;
    }

    // Conta bytes no stream: content-length pode faltar ou mentir.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          log.warn(where, 'Imagem acima do limite');
          return null;
        }
        chunks.push(value);
      }
    } catch (err) {
      log.warn({ ...where, reason: (err as Error)?.name }, 'Falha ao ler imagem');
      return null;
    }
    if (total === 0) return null;
    return { buffer: Buffer.concat(chunks), mimeType };
  }
}
