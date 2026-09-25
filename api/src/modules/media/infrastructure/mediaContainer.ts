import type { IUploadSessionStore } from '../domain/contracts/IUploadSessionStore';
import type { IMediaProcessor } from '../domain/contracts/IMediaProcessor';
import type { IMediaFileStore } from '../domain/contracts/IMediaFileStore';
import type { MediaCapabilities } from '../domain/contracts/MediaCapabilities';
import { DiskUploadSessionStore } from './uploads/DiskUploadSessionStore';
import { FfmpegMediaProcessor } from './ffmpeg/FfmpegMediaProcessor';
import { LocalMediaFileStore } from './storage/LocalMediaFileStore';
import { env } from '../../../shared/config/env';
import { logger } from '../../../shared/logger/logger';
import { mediaFilePath } from '../../../shared/storage/MediaStorage';

/*
 * Composição única do módulo `media` (design §2): rotas do `media`, do `chat` e a varredura
 * usam as MESMAS instâncias. O mutex por upload vive dentro do store e o semáforo do ffmpeg
 * dentro do processador — duas instâncias no processo deixariam de serializar.
 * Criadas no primeiro uso, para importar este arquivo não tocar disco nem processo.
 */
let uploadStore: DiskUploadSessionStore | null = null;
let mediaProcessor: FfmpegMediaProcessor | null = null;
let mediaFileStore: LocalMediaFileStore | null = null;
let initialization: Promise<void> | null = null;

function getUploadStore(): DiskUploadSessionStore {
  uploadStore ??= new DiskUploadSessionStore({ dir: env.MEDIA_UPLOAD_TMP_PATH });
  return uploadStore;
}

function getMediaProcessor(): FfmpegMediaProcessor {
  mediaProcessor ??= new FfmpegMediaProcessor();
  return mediaProcessor;
}

export const mediaContainer = {
  get uploadStore(): IUploadSessionStore {
    return getUploadStore();
  },
  get mediaProcessor(): IMediaProcessor {
    return getMediaProcessor();
  },
  get mediaFileStore(): IMediaFileStore {
    mediaFileStore ??= new LocalMediaFileStore();
    return mediaFileStore;
  },
  /**
   * Sempre ao vivo: antes do `initMediaModule` tudo vem desligado, e quem guardasse um
   * retrato tirado no registro das rotas nunca veria o ffmpeg detectado no boot.
   */
  capabilities(): MediaCapabilities {
    return getMediaProcessor().capabilities();
  },
};

/**
 * Boot do módulo: detecta ffmpeg/ffprobe e prepara a pasta de uploads. Idempotente (a
 * segunda chamada devolve a mesma promessa) e nunca rejeita — sem ffmpeg a API sobe com as
 * capacidades desligadas; sem pasta gravável, o upload falha na hora e o motivo fica no log.
 */
export function initMediaModule(): Promise<void> {
  initialization ??= initialize();
  return initialization;
}

async function initialize(): Promise<void> {
  const log = logger.child({ module: 'mediaContainer' });
  try {
    const [{ transcodeVoice, probe }, { sameDevice }] = await Promise.all([
      getMediaProcessor().detectCapabilities(),
      getUploadStore().ensureReady(mediaFilePath('')),
    ]);
    log.info({ transcodeVoice, probe, sameDevice }, 'Media module ready');
  } catch (err) {
    log.error({ err }, 'Media module failed to initialize — uploads may fail until the upload folder is writable');
  }
}
