import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { S3MediaFileStoreConfig } from '../../../media/infrastructure/storage/S3MediaFileStore';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'outboundMediaTransfer' });

/** Prefixo das chaves temporárias de envio no storage (WROLE-11). Nunca coincide com `filePath` local (absoluto). */
export const OUTBOUND_TMP_PREFIX = 'outbound-tmp/';
/**
 * Idade a partir da qual uma chave temporária é órfã: o envio mais longo espera 300 s e job em espera é
 * removido no timeout, então nada legítimo passa de 1 h. Varredura no worker (boot + a cada 1 h).
 */
export const OUTBOUND_TMP_MAX_AGE_MS = 60 * 60_000;
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
  /** Lista as chaves sob o prefixo com a data de modificação (paginado pelo store). */
  list(prefix: string): AsyncIterable<{ key: string; lastModified: Date }>;
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
  /** Apaga chaves `outbound-tmp/` (só o formato de `stage`) com mais de `maxAgeMs`. Devolve quantas; nunca lança. */
  sweepExpired(maxAgeMs?: number, now?: number): Promise<number>;
}

export class OutboundMediaTransfer implements IOutboundMediaTransfer {
  private sweeping = false;

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

  async sweepExpired(maxAgeMs = OUTBOUND_TMP_MAX_AGE_MS, now = Date.now()): Promise<number> {
    if (this.sweeping) return 0; // passada anterior ainda em curso
    this.sweeping = true;
    let removed = 0;
    try {
      for await (const { key, lastModified } of this.store.list(OUTBOUND_TMP_PREFIX)) {
        if (!isStagedMediaKey(key) || now - lastModified.getTime() <= maxAgeMs) continue;
        try {
          await this.store.delete(key);
          removed++;
        } catch (err) {
          log.warn({ err, key }, 'outbound media: chave órfã não removida');
        }
      }
    } catch (err) {
      log.warn({ err }, 'outbound media: varredura de outbound-tmp/ falhou');
    } finally {
      this.sweeping = false;
    }
    if (removed > 0) log.info({ removed }, 'outbound media: chaves órfãs removidas');
    return removed;
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

  async *list(prefix: string): AsyncIterable<{ key: string; lastModified: Date }> {
    let token: string | undefined;
    do {
      const res = await this.client.send(new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of res.Contents ?? []) {
        if (o.Key && o.LastModified) yield { key: o.Key, lastModified: o.LastModified };
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }
}
