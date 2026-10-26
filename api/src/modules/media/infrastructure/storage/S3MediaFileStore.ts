import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type {
  AcquiredMediaFile,
  IMediaFileStore,
  PromoteMediaFileInput,
  PromotedMediaFile,
} from '../../domain/contracts/IMediaFileStore';
import { mimeTypeToExt } from '../../../../shared/storage/mediaFileExtension';
import { logger } from '../../../../shared/logger/logger';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const MEDIA_PREFIX = 'media/';
const log = logger.child({ module: 'S3MediaFileStore' });

function isCleanBasename(name: string): boolean {
  return (
    name.length > 0 &&
    !name.startsWith('.') &&
    !name.includes('..') &&
    !/[/\\\0]/.test(name)
  );
}

export interface S3MediaFileStoreConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public base URL for the bucket (CDN or R2 public access). */
  publicUrl?: string;
}

export class S3MediaFileStore implements IMediaFileStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly config: S3MediaFileStoreConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
    this.bucket = config.bucket;
    // Trailing slash normalized
    this.publicBaseUrl = (config.publicUrl ?? config.endpoint).replace(/\/$/, '');
  }

  async promote(input: PromoteMediaFileInput): Promise<PromotedMediaFile> {
    const { srcPath, sessionId, externalMessageId, mimeType } = input;
    if (!SAFE_ID.test(sessionId) || !SAFE_ID.test(externalMessageId)) {
      throw new Error('Invalid session or message id for media file name');
    }
    const fileName = `${sessionId}_${externalMessageId}.${mimeTypeToExt(mimeType)}`;
    if (!isCleanBasename(fileName)) throw new Error('Invalid media file name');

    const body = await fs.readFile(srcPath);
    const key = `${MEDIA_PREFIX}${fileName}`;

    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: mimeType || 'application/octet-stream',
    }));

    // Remove source after successful upload
    await fs.rm(srcPath, { force: true });

    const publicUrl = this.objectUrl(key);
    log.debug({ key, sizeBytes: body.length }, 'Media promoted to S3');
    return { publicUrl, localPath: '', sizeBytes: body.length };
  }

  async saveBuffer(buffer: Buffer, filename: string): Promise<string> {
    if (!isCleanBasename(filename)) throw new Error('Invalid media file name');
    const key = `${MEDIA_PREFIX}${filename}`;
    const ext = path.extname(filename).slice(1);
    const contentType = extToMime(ext);

    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));

    return this.objectUrl(key);
  }

  async mediaExists(filename: string): Promise<boolean> {
    if (!isCleanBasename(filename)) return false;
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: `${MEDIA_PREFIX}${filename}`,
      }));
      return true;
    } catch {
      return false;
    }
  }

  publicUrl(filename: string): string {
    return this.objectUrl(`${MEDIA_PREFIX}${filename}`);
  }

  async acquireLocalFile(mediaUrl: string): Promise<AcquiredMediaFile | null> {
    const key = this.urlToKey(mediaUrl);
    if (!key) return null;

    try {
      const res = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));

      if (!res.Body) return null;
      const sizeBytes = res.ContentLength ?? 0;

      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 's3media-'));
      const filePath = path.join(tmpDir, path.basename(key));
      await pipeline(res.Body as Readable, createWriteStream(filePath));

      return {
        filePath,
        sizeBytes,
        async release() {
          await fs.rm(tmpDir, { recursive: true, force: true });
        },
      };
    } catch (err) {
      log.warn({ err, key }, 'Failed to acquire S3 media file');
      return null;
    }
  }

  resolveLocalPath(_mediaUrl: string): string | null {
    return null;
  }

  async remove(pathOrUrl: string): Promise<void> {
    const key = this.urlToKey(pathOrUrl) ?? pathOrUrl;
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
    } catch (err) {
      log.warn({ err, key }, 'Failed to remove S3 media file');
    }
  }

  async exists(pathOrUrl: string): Promise<boolean> {
    const key = this.urlToKey(pathOrUrl) ?? pathOrUrl;
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
      return true;
    } catch {
      return false;
    }
  }

  private objectUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  private urlToKey(url: string): string | null {
    const prefix = `${this.publicBaseUrl}/`;
    if (url.startsWith(prefix)) {
      return url.slice(prefix.length);
    }
    // Also try extracting from the bucket path (endpoint/bucket/key)
    const endpointPrefix = `${this.config.endpoint.replace(/\/$/, '')}/${this.bucket}/`;
    if (url.startsWith(endpointPrefix)) {
      return url.slice(endpointPrefix.length);
    }
    return null;
  }
}

/** Best-effort reverse lookup from file extension to MIME type for upload. */
function extToMime(ext: string): string {
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    gif: 'image/gif', mp4: 'video/mp4', mp3: 'audio/mpeg', m4a: 'audio/mp4',
    ogg: 'audio/ogg', aac: 'audio/aac', pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
    mov: 'video/quicktime', '3gpp': 'video/3gpp', mpeg: 'video/mpeg',
  };
  return map[ext.toLowerCase()] ?? 'application/octet-stream';
}
