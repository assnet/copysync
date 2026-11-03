import { prepareWAMessageMedia, type WAMediaUploadFunction, type WAUrlInfo } from '@whiskeysockets/baileys';
import type { OutboundLinkPreview } from '../../../domain/contracts/IMessagingEngine';

export interface BuildBaileysLinkPreviewDeps {
  /** `socket.waUploadToServer`; injetado para teste. */
  upload: WAMediaUploadFunction;
  /** Sem ele upload travado prende o envio até o timeout do disparo (env.MEDIA_UPLOAD_IDLE_TIMEOUT_MS). */
  uploadTimeoutMs: number;
  /** Chamado quando a miniatura grande não subiu; o envio segue só com a pequena. */
  onUploadFailed?: (err: unknown) => void;
}

/**
 * `linkPreview` do Baileys montado com as imagens que já temos: definido, o
 * `generateWAMessageContent` não busca a página (`Utils/messages.js`, ramo `text`).
 *
 * - `imageJpeg` sobe como `thumbnail-link` (cartão grande). Sem `jpegThumbnail` no
 *   `prepareWAMessageMedia`: a lib mede width/height com sharp; o 32 px que ela gera é descartado
 * - upload falhou ou estourou o tempo → cartão só com a miniatura pequena (`thumbnailJpeg`)
 * - `canonical-url` é exigido pelo tipo mas a lib só usa `matched-text`
 */
export async function buildBaileysLinkPreview(
  preview: OutboundLinkPreview,
  deps: BuildBaileysLinkPreviewDeps,
): Promise<WAUrlInfo> {
  const info: WAUrlInfo = {
    'canonical-url': preview.url,
    'matched-text': preview.url,
    title: preview.title,
    ...(preview.description ? { description: preview.description } : {}),
    ...(preview.thumbnailJpeg ? { jpegThumbnail: preview.thumbnailJpeg } : {}),
  };
  if (!preview.imageJpeg) return info;

  try {
    const { imageMessage } = await prepareWAMessageMedia(
      { image: preview.imageJpeg },
      { upload: deps.upload, mediaTypeOverride: 'thumbnail-link', mediaUploadTimeoutMs: deps.uploadTimeoutMs },
    );
    if (imageMessage) info.highQualityThumbnail = imageMessage;
  } catch (err) {
    deps.onUploadFailed?.(err);
  }
  return info;
}
