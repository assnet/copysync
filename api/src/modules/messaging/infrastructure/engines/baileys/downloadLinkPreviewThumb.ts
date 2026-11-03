import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import type { InboundLinkPreview } from './pickInboundLinkPreview';

/** Teto da miniatura grande (`thumbnail-link`), contado no stream (spec P2 AC3/AC6). */
export const LINK_PREVIEW_HQ_THUMB_MAX_BYTES = 1024 * 1024;

type HqThumbRef = NonNullable<InboundLinkPreview['hq']>;
type CappedStream = AsyncIterable<Uint8Array> & { destroy?: (err?: Error) => void };

/**
 * Lê o stream somando os pedaços; passou do teto → `destroy()` e null, sem juntar o que veio.
 * O `Buffer.concat` só roda depois de o total caber.
 */
export async function readStreamCapped(stream: CappedStream, maxBytes: number): Promise<Buffer | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) {
      stream.destroy?.();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

/** JPEG (FF D8 FF); a miniatura grande também passa pela checagem de tipo (AC6). */
function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

export type LinkPreviewThumbDownloader = (
  ref: { directPath: string; mediaKey: Uint8Array },
  type: 'thumbnail-link',
) => Promise<CappedStream>;

/**
 * Teto do download da miniatura grande. Roda com await no `messages.upsert`, antes do
 * `MESSAGE_RECEIVED`: o fetch do Baileys não tem signal, então sem isso um servidor de mídia
 * travado segura a entrega da mensagem. Estourou → stream destruído e fica a pequena.
 */
export const LINK_PREVIEW_HQ_DOWNLOAD_TIMEOUT_MS = 10_000;

/**
 * Baixa a miniatura grande da prévia do servidor de mídia do WhatsApp (nunca a URL do link).
 * null = acima do teto ou não é JPEG. Erro de rede/decifra/tempo esgotado sobe para o chamador.
 */
export async function downloadLinkPreviewThumb(
  hq: HqThumbRef,
  download: LinkPreviewThumbDownloader = downloadContentFromMessage as unknown as LinkPreviewThumbDownloader,
  timeoutMs: number = LINK_PREVIEW_HQ_DOWNLOAD_TIMEOUT_MS,
): Promise<Buffer | null> {
  let stream: CappedStream | undefined;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutErr = new Error('Link preview HQ thumbnail download timed out');

  const work = (async () => {
    stream = await download({ directPath: hq.directPath, mediaKey: hq.mediaKey }, 'thumbnail-link');
    if (timedOut) {
      stream.destroy?.(timeoutErr);
      return null;
    }
    const buf = await readStreamCapped(stream, LINK_PREVIEW_HQ_THUMB_MAX_BYTES);
    return buf && isJpeg(buf) ? buf : null;
  })();
  // Depois do tempo esgotado a rejeição do trabalho não tem mais quem a espere.
  work.catch(() => undefined);

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      stream?.destroy?.(timeoutErr);
      reject(timeoutErr);
    }, timeoutMs);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
