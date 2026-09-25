import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import type {
  IMediaFileStore,
  PromoteMediaFileInput,
  PromotedMediaFile,
} from '../../domain/contracts/IMediaFileStore';
import { mediaFilePath, mediaPublicUrl } from '../../../../shared/storage/MediaStorage';
import { mimeTypeToExt } from '../../../../shared/storage/mediaFileExtension';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Nome de arquivo direto na pasta: sem separador, sem `..`, sem oculto e sem byte nulo. */
function isCleanBasename(name: string): boolean {
  return (
    name.length > 0 &&
    !name.startsWith('.') &&
    !name.includes('..') &&
    !/[/\\\0]/.test(name)
  );
}

/**
 * Pasta de mídia em disco local — a mesma do download da mídia recebida (`MediaStorage`).
 *
 * A pasta é injetável para os testes rodarem em pasta temporária própria.
 */
export class LocalMediaFileStore implements IMediaFileStore {
  // `mediaFilePath('')` resolve a própria pasta de mídia; `mediaPublicUrl('')`, o prefixo público.
  constructor(private readonly mediaDir: string = mediaFilePath('')) {}

  async promote(input: PromoteMediaFileInput): Promise<PromotedMediaFile> {
    const { srcPath, sessionId, externalMessageId, mimeType } = input;
    // Validado antes de montar o caminho: os ids viram nome de arquivo.
    if (!SAFE_ID.test(sessionId) || !SAFE_ID.test(externalMessageId)) {
      throw new Error('Invalid session or message id for media file name');
    }
    const fileName = `${sessionId}_${externalMessageId}.${mimeTypeToExt(mimeType)}`;
    // O que é promovido tem de voltar pelo `resolveLocalPath` no envio.
    if (!isCleanBasename(fileName)) {
      throw new Error('Invalid media file name');
    }

    const destPath = path.join(this.mediaDir, fileName);
    await fs.mkdir(this.mediaDir, { recursive: true });
    await this.move(srcPath, destPath);
    const { size } = await fs.stat(destPath);
    return { publicUrl: mediaPublicUrl(fileName), localPath: destPath, sizeBytes: size };
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

  /** `rename` é atômico; entre discos (`EXDEV`) vira cópia por stream + unlink da origem. */
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
      // Cópia pela metade não pode ficar servível na pasta de mídia.
      await fs.rm(destPath, { force: true });
      throw err;
    }
    await fs.unlink(srcPath);
  }
}
