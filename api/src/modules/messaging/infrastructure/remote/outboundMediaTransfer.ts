import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { S3MediaFileStoreConfig } from '../../../media/infrastructure/storage/S3MediaFileStore';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'outboundMediaTransfer' });

/** Prefixo das chaves temporárias de envio no storage (WROLE-11). Nunca coincide com `filePath` local (absoluto). */
export const OUTBOUND_TMP_PREFIX = 'outbound-tmp/';
const KEY_RE = /^outbound-tmp\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,10})?$/;
const EXT_RE = /^\.[a-z0-9]{1,10}$/;

/** `filePath` do envio é chave preparada por `stage` (só o formato que `stage` gera). */
export function isStagedMediaKey(value: string): boolean {
  return KEY_RE.test(value);
}

/** Objetos crus do storage: só o que a transferência usa. */
export interface OutboundObjectStore {
  upload(key: string, filePath: string, contentType: string): Promise<void>;
  download(key: string, destPath: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface FetchedOutboundMedia {
  filePath: string;
  /** Apaga o arquivo temporário local. Nunca lança. */
  release(): Promise<void>;
}

/** Arquivo de envio de mídia entre `http` e `worker` pelo storage. */
export interface IOutboundMediaTransfer {
  /** `http`: sobe o arquivo local (não o apaga) e devolve a chave `outbound-tmp/{uuid}[.ext]`. */
  stage(filePath: string, mimeType: string): Promise<string>;
  /** `worker`: baixa a chave para arquivo temporário local. */
  fetch(key: string): Promise<FetchedOutboundMedia>;
  /** Apaga a chave. Idempotente; nunca lança. */
  discard(key: string): Promise<void>;
}

export class OutboundMediaTransfer implements IOutboundMediaTransfer {
  constructor(private readonly store: OutboundObjectStore) {}

  async stage(filePath: string, mimeType: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();
    const key = `${OUTBOUND_TMP_PREFIX}${randomUUID()}${EXT_RE.test(ext) ? ext : ''}`;
    await this.store.upload(key, filePath, mimeType || 'application/octet-stream');
    return key;
  }

  async fetch(key: string): Promise<FetchedOutboundMedia> {
    if (!isStagedMediaKey(key)) throw new TypeError('outbound media: chave inválida');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'outbound-media-'));
    const release = async () => {
      await fs.rm(dir, { recursive: true, force: true }).catch((err: unknown) => log.warn({ err, dir }, 'outbound media: tmp não removido'));
    };
    const filePath = path.join(dir, path.basename(key));
    try {
      await this.store.download(key, filePath);
    } catch (err) {
      await release();
      throw err;
    }
    return { filePath, release };
  }

  async discard(key: string): Promise<void> {
    if (!isStagedMediaKey(key)) return;
    try {
      await this.store.delete(key);
    } catch (err) {
      log.warn({ err, key }, 'outbound media: chave não removida');
    }
  }
}

/** `OutboundObjectStore` no mesmo bucket do `S3MediaFileStore` (mesma config). */
export class S3OutboundObjectStore implements OutboundObjectStore {
  private readonly client: S3Client;

  constructor(private readonly config: S3MediaFileStoreConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: true,
    });
  }

  async upload(key: string, filePath: string, contentType: string): Promise<void> {
    const body = await fs.readFile(filePath);
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async download(key: string, destPath: string): Promise<void> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    if (!res.Body) throw new Error('outbound media: objeto vazio');
    await pipeline(res.Body as Readable, createWriteStream(destPath));
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}
