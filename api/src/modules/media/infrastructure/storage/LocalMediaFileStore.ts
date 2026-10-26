import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import type {
  AcquiredMediaFile,
  IMediaFileStore,
  PromoteMediaFileInput,
  PromotedMediaFile,
} from '../../domain/contracts/IMediaFileStore';
import { mediaFilePath, mediaPublicUrl } from '../../../../shared/storage/MediaStorage';
import { mimeTypeToExt } from '../../../../shared/storage/mediaFileExtension';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function isCleanBasename(name: string): boolean {
  return (
    name.length > 0 &&
    !name.startsWith('.') &&
    !name.includes('..') &&
    !/[/\\\0]/.test(name)
  );
}

export class LocalMediaFileStore implements IMediaFileStore {
  constructor(private readonly mediaDir: string = mediaFilePath('')) {}

  async promote(input: PromoteMediaFileInput): Promise<PromotedMediaFile> {
    const { srcPath, sessionId, externalMessageId, mimeType } = input;
    if (!SAFE_ID.test(sessionId) || !SAFE_ID.test(externalMessageId)) {
      throw new Error('Invalid session or message id for media file name');
    }
    const fileName = `${sessionId}_${externalMessageId}.${mimeTypeToExt(mimeType)}`;
    if (!isCleanBasename(fileName)) {
      throw new Error('Invalid media file name');
    }

    const destPath = path.join(this.mediaDir, fileName);
    await fs.mkdir(this.mediaDir, { recursive: true });
    await this.move(srcPath, destPath);
    const { size } = await fs.stat(destPath);
    return { publicUrl: mediaPublicUrl(fileName), localPath: destPath, sizeBytes: size };
  }

  async saveBuffer(buffer: Buffer, filename: string): Promise<string> {
    if (!isCleanBasename(filename)) throw new Error('Invalid media file name');
    await fs.mkdir(this.mediaDir, { recursive: true });
    await fs.writeFile(path.join(this.mediaDir, filename), buffer);
    return mediaPublicUrl(filename);
  }

  async mediaExists(filename: string): Promise<boolean> {
    if (!isCleanBasename(filename)) return false;
    try {
      await fs.access(path.join(this.mediaDir, filename));
      return true;
    } catch {
      return false;
    }
  }

  publicUrl(filename: string): string {
    return mediaPublicUrl(filename);
  }

  async acquireLocalFile(mediaUrl: string): Promise<AcquiredMediaFile | null> {
    const filePath = this.resolveLocalPath(mediaUrl);
    if (!filePath) return null;
    try {
      const { size } = await fs.stat(filePath);
      return { filePath, sizeBytes: size, release: async () => {} };
    } catch {
      return null;
    }
  }

  resolveLocalPath(mediaUrl: string): string | null {
    const prefix = mediaPublicUrl('');
    if (!mediaUrl.startsWith(prefix)) return null;
    const fileName = mediaUrl.slice(prefix.length);
    return isCleanBasename(fileName) ? path.join(this.mediaDir, fileName) : null;
  }

  async remove(localPath: string): Promise<void> {
    await fs.rm(localPath, { force: true });
  }

  async exists(localPath: string): Promise<boolean> {
    try {
      await fs.access(localPath);
      return true;
    } catch {
      return false;
    }
  }

  private async move(srcPath: string, destPath: string): Promise<void> {
    try {
      await fs.rename(srcPath, destPath);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    }
    try {
      await pipeline(createReadStream(srcPath), createWriteStream(destPath));
    } catch (err) {
      await fs.rm(destPath, { force: true });
      throw err;
    }
    await fs.unlink(srcPath);
  }
}
