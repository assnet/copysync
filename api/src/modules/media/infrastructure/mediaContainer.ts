import type { IUploadSessionStore } from '../domain/contracts/IUploadSessionStore';
import type { IMediaProcessor } from '../domain/contracts/IMediaProcessor';
import type { IMediaFileStore } from '../domain/contracts/IMediaFileStore';
import type { MediaCapabilities } from '../domain/contracts/MediaCapabilities';
import { DiskUploadSessionStore } from './uploads/DiskUploadSessionStore';
import { FfmpegMediaProcessor } from './ffmpeg/FfmpegMediaProcessor';
import { LocalMediaFileStore } from './storage/LocalMediaFileStore';
import { S3MediaFileStore } from './storage/S3MediaFileStore';
import { env } from '../../../shared/config/env';
import { logger } from '../../../shared/logger/logger';
import { mediaFilePath } from '../../../shared/storage/MediaStorage';

let uploadStore: DiskUploadSessionStore | null = null;
let mediaProcessor: FfmpegMediaProcessor | null = null;
let mediaFileStore: IMediaFileStore | null = null;
let initialization: Promise<void> | null = null;

function getUploadStore(): DiskUploadSessionStore {
  uploadStore ??= new DiskUploadSessionStore({ dir: env.MEDIA_UPLOAD_TMP_PATH });
  return uploadStore;
}

function getMediaProcessor(): FfmpegMediaProcessor {
  mediaProcessor ??= new FfmpegMediaProcessor();
  return mediaProcessor;
}

function getMediaFileStore(): IMediaFileStore {
  if (mediaFileStore) return mediaFileStore;

  if (env.S3_ENABLED) {
    mediaFileStore = new S3MediaFileStore({
      endpoint:        env.S3_ENDPOINT!,
      bucket:          env.S3_BUCKET!,
      region:          env.S3_REGION,
      accessKeyId:     env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      publicUrl:       env.S3_PUBLIC_URL,
    });
    logger.info({ driver: 's3', bucket: env.S3_BUCKET }, 'Media file store: S3/R2');
  } else {
    mediaFileStore = new LocalMediaFileStore();
    logger.info({ driver: 'local' }, 'Media file store: local disk');
  }

  return mediaFileStore;
}

export const mediaContainer = {
  get uploadStore(): IUploadSessionStore {
    return getUploadStore();
  },
  get mediaProcessor(): IMediaProcessor {
    return getMediaProcessor();
  },
  get mediaFileStore(): IMediaFileStore {
    return getMediaFileStore();
  },
  capabilities(): MediaCapabilities {
    return getMediaProcessor().capabilities();
  },
};

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
    // Eagerly create file store so config issues surface at boot
    getMediaFileStore();
    log.info({ transcodeVoice, probe, sameDevice }, 'Media module ready');
  } catch (err) {
    log.error({ err }, 'Media module failed to initialize — uploads may fail until the upload folder is writable');
  }
}
