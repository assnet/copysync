import type { OutboundMedia } from '../../../domain/contracts/IMessagingEngine';

/** A lib lê o arquivo do disco em stream: `{ url: caminhoLocal }`, nunca o conteúdo em memória. */
interface BaileysMediaSource {
  url: string;
}

/**
 * Conteúdo de mídia no formato que o `sendMessage` do Baileys lê. Declarado aqui para a montagem
 * não depender dos tipos internos da lib (AGENTS.md §9/§11); o adapter faz o cast. `seconds` de
 * vídeo e `waveform` ficam fora do tipo da lib, mas o proto os aceita.
 */
export type BaileysMediaContent =
  | { image: BaileysMediaSource; mimetype?: string; caption?: string }
  | {
    video: BaileysMediaSource;
    mimetype?: string;
    caption?: string;
    seconds?: number;
    width?: number;
    height?: number;
    /** base64: o proto decodifica o texto para bytes. */
    jpegThumbnail?: string;
    gifPlayback: false;
  }
  | { audio: BaileysMediaSource; ptt: true; mimetype: string; seconds?: number; waveform?: Uint8Array }
  | { document: BaileysMediaSource; mimetype: string; fileName: string; caption?: string };

/** MIME que o WhatsApp exige para tocar como nota de voz. */
const VOICE_MIME_TYPE = 'audio/ogg; codecs=opus';
/**
 * Documento sem MIME ou nome não pode cair no padrão da lib (`application/pdf` e `file`): um
 * zip chegaria rotulado como PDF.
 */
const DOCUMENT_FALLBACK_MIME_TYPE = 'application/octet-stream';
const DOCUMENT_FALLBACK_FILE_NAME = 'file';

/** Texto com conteúdo, ou `undefined` (vazio e só espaços contam como ausente). */
function text(value: string | null | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}

/** Inteiro positivo, ou `undefined` — o proto guarda duração e dimensões como inteiros. */
function positiveInt(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

/** Copia só os campos definidos: campo vazio não vai ao `sendMessage`. */
function defined<T extends object>(fields: T): T {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as T;
}

/**
 * Monta o conteúdo do `sendMessage` a partir do arquivo pronto para envio (design §9).
 *
 * - voz: `ptt` no nível de cima — dentro do objeto do arquivo a lib ignora e o áudio chega
 *   como arquivo comum. Sem legenda (nota de voz não tem)
 * - vídeo: nunca como GIF; sem miniatura, a lib gera a dela
 * - documento: sempre com MIME e nome
 * - legenda, MIME, duração, dimensões, miniatura e onda vazios ficam de fora
 */
export function buildBaileysMediaContent(media: OutboundMedia): BaileysMediaContent {
  const source = { url: media.filePath };
  const caption = text(media.caption);

  switch (media.kind) {
    case 'image':
      return defined({ image: source, mimetype: text(media.mimeType), caption });
    case 'video':
      return defined({
        video: source,
        mimetype: text(media.mimeType),
        caption,
        seconds: positiveInt(media.durationSeconds),
        width: positiveInt(media.width),
        height: positiveInt(media.height),
        jpegThumbnail: text(media.thumbnailJpegBase64),
        gifPlayback: false as const,
      });
    case 'voice':
      return defined({
        audio: source,
        ptt: true as const,
        mimetype: VOICE_MIME_TYPE,
        seconds: positiveInt(media.durationSeconds),
        waveform: media.waveform?.length ? media.waveform : undefined,
      });
    case 'document':
      return defined({
        document: source,
        mimetype: text(media.mimeType) ?? DOCUMENT_FALLBACK_MIME_TYPE,
        fileName: text(media.fileName) ?? DOCUMENT_FALLBACK_FILE_NAME,
        caption,
      });
  }
}
