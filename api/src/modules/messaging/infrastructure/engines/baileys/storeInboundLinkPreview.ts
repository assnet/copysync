import type { InboundLinkPreview } from './pickInboundLinkPreview';
import { downloadLinkPreviewThumb } from './downloadLinkPreviewThumb';
import type { MessageLinkPreview } from '../../../../../shared/events/InternalMessagingEvent';

export interface StoreInboundLinkPreviewInput {
  preview: InboundLinkPreview;
  sessionId: string;
  msgId: string;
  /** false = só textos (histórico fora da janela de 30 min). */
  saveThumbs: boolean;
  /** Regra de download de mídia (contato = sempre; grupo = `autoDownloadMedia`). Só consultada se houver `hq`. */
  allowHq: () => Promise<boolean>;
  store: { saveBuffer(buffer: Buffer, filename: string): Promise<string> };
  downloadHq?: (hq: NonNullable<InboundLinkPreview['hq']>) => Promise<Buffer | null>;
  logger: { warn(obj: object, msg: string): void };
}

/**
 * Grava as miniaturas da prévia recebida e devolve o dado do evento (spec P2 AC2/AC3).
 * Pequena (veio na mensagem) sempre, sem flag; grande só com a regra de download, no mesmo
 * arquivo. Falha em qualquer uma mantém o que já foi gravado. Nunca acessa a URL do link e
 * não loga URL nem título.
 */
export async function storeInboundLinkPreview(input: StoreInboundLinkPreviewInput): Promise<MessageLinkPreview> {
  const { preview, sessionId, msgId, store, logger } = input;
  const filename = `${sessionId}_${msgId}_lp.jpg`;
  let thumbnailUrl: string | null = null;

  if (input.saveThumbs && preview.inlineThumb) {
    try {
      thumbnailUrl = await store.saveBuffer(preview.inlineThumb, filename);
    } catch (err) {
      logger.warn({ err, sessionId, msgId }, 'Failed to store inline link preview thumbnail');
    }
  }

  if (input.saveThumbs && preview.hq && await input.allowHq()) {
    try {
      const buf = await (input.downloadHq ?? downloadLinkPreviewThumb)(preview.hq);
      if (buf) {
        thumbnailUrl = await store.saveBuffer(buf, filename);
      } else {
        logger.warn({ sessionId, msgId }, 'Link preview HQ thumbnail rejected (size/type); keeping inline one');
      }
    } catch (err) {
      logger.warn({ err, sessionId, msgId }, 'Failed to download link preview HQ thumbnail; keeping inline one');
    }
  }

  return { url: preview.url, title: preview.title, description: preview.description, thumbnailUrl };
}
