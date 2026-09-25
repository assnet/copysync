import type { MediaCapabilities } from '../contracts/MediaCapabilities';

/** Mesmo limite do texto (`sendMessageBodySchema`): legenda é corpo de mensagem. */
const MAX_CAPTION_LENGTH = 4096;
/** Folga por segundo de gravação: Opus/AAC de navegador fica bem abaixo disso. */
const VOICE_BYTES_PER_SECOND = 64 * 1024;

/**
 * Recorte da configuração que o painel precisa conhecer.
 *
 * Os nomes são os das variáveis de ambiente para o `env` caber aqui sem tradução —
 * mas a função não importa `env`: quem chama passa o objeto, e o teste passa o dele.
 */
export interface MediaUploadSettings {
  MEDIA_UPLOAD_CHUNK_BYTES: number;
  MEDIA_MAX_FILES_PER_BATCH: number;
  MEDIA_MAX_VOICE_SECONDS: number;
  MEDIA_MAX_IMAGE_BYTES: number;
  MEDIA_MAX_INLINE_VIDEO_BYTES: number;
  MEDIA_MAX_DOCUMENT_BYTES: number;
}

/** Resposta de `GET /media/uploads/config`. */
export interface MediaUploadConfig {
  chunkSizeBytes: number;
  maxFilesPerBatch: number;
  maxVoiceSeconds: number;
  maxCaptionLength: number;
  limits: {
    imageBytes: number;
    inlineVideoBytes: number;
    documentBytes: number;
    voiceBytes: number;
  };
  capabilities: {
    voiceNotes: boolean;
    videoMetadata: boolean;
  };
}

/**
 * Monta o config público de upload: limites para o painel avisar antes de subir e
 * capacidades para esconder o que o servidor não sabe fazer (voz sem ffmpeg, metadados
 * de vídeo sem ffprobe).
 *
 * Voz exige ffmpeg **e** ffprobe: a confirmação transcodifica e lê a duração da saída. Esta é a
 * fonte única da regra — a criação do upload também recusa por ela, então o painel nunca mostra
 * o gravador para um envio que a confirmação recusaria.
 */
export function buildMediaUploadConfig(
  settings: MediaUploadSettings,
  capabilities: MediaCapabilities,
): MediaUploadConfig {
  return {
    chunkSizeBytes: settings.MEDIA_UPLOAD_CHUNK_BYTES,
    maxFilesPerBatch: settings.MEDIA_MAX_FILES_PER_BATCH,
    maxVoiceSeconds: settings.MEDIA_MAX_VOICE_SECONDS,
    maxCaptionLength: MAX_CAPTION_LENGTH,
    limits: {
      imageBytes: settings.MEDIA_MAX_IMAGE_BYTES,
      inlineVideoBytes: settings.MEDIA_MAX_INLINE_VIDEO_BYTES,
      documentBytes: settings.MEDIA_MAX_DOCUMENT_BYTES,
      voiceBytes: settings.MEDIA_MAX_VOICE_SECONDS * VOICE_BYTES_PER_SECOND,
    },
    capabilities: {
      voiceNotes: capabilities.transcodeVoice && capabilities.probe,
      videoMetadata: capabilities.probe,
    },
  };
}
