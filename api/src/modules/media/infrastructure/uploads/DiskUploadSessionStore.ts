import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import type {
  BeginConsumeResult,
  CreateUploadSessionInput,
  IUploadSessionStore,
  UploadDiskStats,
  UploadSessionRecord,
  UploadSessionState,
  WriteUploadPartResult,
} from '../../domain/contracts/IUploadSessionStore';
import { planUpload, validatePart } from '../../domain/services/uploadPlan';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import { logger } from '../../../../shared/logger/logger';

/** Só o formato que `randomUUID` gera: nenhum outro texto vira caminho. */
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Inclui a saída do transcode de voz (`<id>.voice.<ext>`): ela também pertence ao upload. */
const UPLOAD_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(?:bin|json|json\.tmp|voice\.[a-z0-9]+)$/;
const NOT_CONSUMED: ReadonlySet<UploadSessionState> = new Set(['OPEN', 'CONSUMING']);

export interface DiskUploadSessionStoreOptions {
  /** `MEDIA_UPLOAD_TMP_PATH`. */
  dir: string;
  /** Relógio de `createdAt`/`updatedAt`; injetável no teste. */
  now?: () => Date;
}

/**
 * Upload em partes no disco local: `<id>.bin` esparso escrito por posição e `<id>.json`
 * gravado atômico (`tmp` + `rename`).
 *
 * Um mutex em memória por `uploadId` serializa parte + lateral — vale para um processo só,
 * por isso o container cria uma única instância.
 */
export class DiskUploadSessionStore implements IUploadSessionStore {
  private readonly dir: string;
  private readonly now: () => Date;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(options: DiskUploadSessionStoreOptions) {
    this.dir = options.dir;
    this.now = options.now ?? (() => new Date());
  }

  async create(input: CreateUploadSessionInput): Promise<UploadSessionRecord> {
    const { totalParts } = planUpload(input.sizeBytes, input.chunkSizeBytes);
    const uploadId = randomUUID();
    const timestamp = this.now().toISOString();
    const record: UploadSessionRecord = {
      uploadId,
      tenantId: input.tenantId,
      userId: input.userId,
      purpose: input.purpose,
      fileName: input.fileName,
      declaredMimeType: input.declaredMimeType,
      sizeBytes: input.sizeBytes,
      chunkSizeBytes: input.chunkSizeBytes,
      totalParts,
      receivedParts: [],
      state: 'OPEN',
      externalMessageId: null,
      messageId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return this.withLock(uploadId, async () => {
      const handle = await fs.open(this.filePath(uploadId, 'bin'), 'w');
      try {
        await handle.truncate(input.sizeBytes);
      } finally {
        await handle.close();
      }
      try {
        await this.writeRecord(record);
      } catch (err) {
        await fs.rm(this.filePath(uploadId, 'bin'), { force: true });
        throw err;
      }
      return record;
    });
  }

  async get(uploadId: string, tenantId: string, userId: string): Promise<UploadSessionRecord | null> {
    if (!UPLOAD_ID.test(uploadId)) return null;
    const record = await this.readRecord(uploadId);
    return record && isOwner(record, tenantId, userId) ? record : null;
  }

  async writePart(uploadId: string, index: number, data: Uint8Array): Promise<WriteUploadPartResult> {
    if (!UPLOAD_ID.test(uploadId)) return { status: 'not_found' };

    return this.withLock(uploadId, async (): Promise<WriteUploadPartResult> => {
      const record = await this.readRecord(uploadId);
      if (!record) return { status: 'not_found' };
      if (record.state !== 'OPEN') return { status: 'not_open', record };

      // Defesa do arquivo: parte fora do plano escreveria além do fim declarado.
      const check = validatePart({
        sizeBytes: record.sizeBytes,
        chunkSizeBytes: record.chunkSizeBytes,
        index,
        length: data.byteLength,
      });
      if (!check.ok) {
        throw new ValidationError('Upload part does not match the plan', { index, reason: check.reason });
      }

      const handle = await openExisting(this.filePath(uploadId, 'bin'), 'r+');
      if (!handle) return { status: 'not_found' };
      try {
        const position = index * record.chunkSizeBytes;
        let written = 0;
        while (written < data.byteLength) {
          const { bytesWritten } = await handle.write(data, written, data.byteLength - written, position + written);
          written += bytesWritten;
        }
      } finally {
        await handle.close();
      }

      const next = this.touch({ ...record, receivedParts: addPart(record.receivedParts, index) });
      await this.writeRecord(next);
      return { status: 'written', record: next };
    });
  }

  async beginConsume(uploadId: string, tenantId: string, userId: string): Promise<BeginConsumeResult> {
    if (!UPLOAD_ID.test(uploadId)) return { outcome: 'not_found' };

    return this.withLock(uploadId, async (): Promise<BeginConsumeResult> => {
      const record = await this.readRecord(uploadId);
      if (!record || !isOwner(record, tenantId, userId)) return { outcome: 'not_found' };
      if (record.state === 'CONSUMED' && record.messageId) {
        return { outcome: 'consumed', messageId: record.messageId, record };
      }
      if (record.state !== 'OPEN') return { outcome: 'in_progress', record };
      if (record.receivedParts.length !== record.totalParts) return { outcome: 'incomplete', record };

      const next = this.touch({ ...record, state: 'CONSUMING' });
      await this.writeRecord(next);
      return { outcome: 'started', record: next };
    });
  }

  setExternalId(uploadId: string, externalMessageId: string): Promise<UploadSessionRecord | null> {
    return this.transition(uploadId, 'CONSUMING', { externalMessageId });
  }

  releaseConsume(uploadId: string): Promise<UploadSessionRecord | null> {
    return this.transition(uploadId, 'CONSUMING', { state: 'OPEN', externalMessageId: null });
  }

  finishConsume(uploadId: string, messageId: string): Promise<UploadSessionRecord | null> {
    return this.transition(uploadId, 'CONSUMING', { state: 'CONSUMED', messageId });
  }

  async discard(uploadId: string): Promise<void> {
    if (!UPLOAD_ID.test(uploadId)) return;
    await this.withLock(uploadId, () => this.removeFiles(uploadId));
  }

  async discardIfOpen(uploadId: string): Promise<boolean> {
    if (!UPLOAD_ID.test(uploadId)) return false;
    return this.withLock(uploadId, async () => {
      const record = await this.readRecord(uploadId);
      if (record?.state !== 'OPEN') return false;
      await this.removeFiles(uploadId);
      return true;
    });
  }

  async listByState(state: UploadSessionState): Promise<UploadSessionRecord[]> {
    return (await this.readAllRecords()).filter((record) => record.state === state);
  }

  async listExpired(now: Date, ttlMs: number): Promise<string[]> {
    const expired: string[] = [];
    for (const [uploadId, files] of await this.listUploadFiles()) {
      const record = await this.readRecord(uploadId);
      const lastActivity = record ? Date.parse(record.updatedAt) : await newestMtime(this.dir, files);
      if (now.getTime() - lastActivity > ttlMs) expired.push(uploadId);
    }
    return expired;
  }

  async countOpenByUser(tenantId: string, userId: string): Promise<number> {
    return (await this.readAllRecords()).filter(
      (record) => NOT_CONSUMED.has(record.state) && isOwner(record, tenantId, userId),
    ).length;
  }

  async openReservedBytes(): Promise<number> {
    return (await this.readAllRecords())
      .filter((record) => NOT_CONSUMED.has(record.state))
      .reduce((sum, record) => sum + record.sizeBytes, 0);
  }

  async diskStats(): Promise<UploadDiskStats> {
    const stats = await fs.statfs(this.dir);
    return { totalBytes: stats.bsize * stats.blocks, freeBytes: stats.bsize * stats.bavail };
  }

  async readHead(uploadId: string, bytes: number): Promise<Uint8Array | null> {
    if (!UPLOAD_ID.test(uploadId)) return null;
    const handle = await openExisting(this.filePath(uploadId, 'bin'), 'r');
    if (!handle) return null;
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  binPath(uploadId: string): string | null {
    return UPLOAD_ID.test(uploadId) ? this.filePath(uploadId, 'bin') : null;
  }

  async ensureReady(mediaDir: string): Promise<{ sameDevice: boolean }> {
    await fs.mkdir(this.dir, { recursive: true });
    // Pasta sem escrita derruba o boot aqui, não no primeiro upload.
    const probe = path.join(this.dir, `.write-check-${process.pid}`);
    await fs.writeFile(probe, '');
    await fs.rm(probe, { force: true });

    await fs.mkdir(mediaDir, { recursive: true });
    const [uploads, media] = await Promise.all([fs.stat(this.dir), fs.stat(mediaDir)]);
    const sameDevice = uploads.dev === media.dev;
    if (!sameDevice) {
      logger.warn(
        { uploadDir: this.dir, mediaDir },
        'Upload folder and media folder are on different devices — promotion will copy instead of rename',
      );
    }
    return { sameDevice };
  }

  /** Aplica `patch` só se o upload estiver em `from`; em outro estado devolve como está. */
  private async transition(
    uploadId: string,
    from: UploadSessionState,
    patch: Partial<Pick<UploadSessionRecord, 'state' | 'externalMessageId' | 'messageId'>>,
  ): Promise<UploadSessionRecord | null> {
    if (!UPLOAD_ID.test(uploadId)) return null;
    return this.withLock(uploadId, async () => {
      const record = await this.readRecord(uploadId);
      if (!record || record.state !== from) return record;
      const next = this.touch({ ...record, ...patch });
      await this.writeRecord(next);
      return next;
    });
  }

  /** Encadeia a tarefa atrás da anterior do mesmo upload; falha de uma não trava a fila. */
  private withLock<T>(uploadId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(uploadId) ?? Promise.resolve();
    const run = previous.then(task);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(uploadId, tail);
    void tail.then(() => {
      if (this.locks.get(uploadId) === tail) this.locks.delete(uploadId);
    });
    return run;
  }

  private touch(record: UploadSessionRecord): UploadSessionRecord {
    return { ...record, updatedAt: this.now().toISOString() };
  }

  /**
   * Arquivo, lateral e o que sobrou de um transcode de voz interrompido. A saída do transcode
   * tem extensão variável, então só a listagem da pasta a encontra. Chamado sob o mutex.
   */
  private async removeFiles(uploadId: string): Promise<void> {
    const fixed = (['bin', 'json', 'json.tmp'] as const).map((ext) => `${uploadId}.${ext}`);
    const found = (await this.listUploadFiles()).get(uploadId) ?? [];
    await Promise.all(
      [...new Set([...fixed, ...found])].map((name) => fs.rm(path.join(this.dir, name), { force: true })),
    );
  }

  /** Chamado só com `uploadId` já validado. */
  private filePath(uploadId: string, ext: 'bin' | 'json' | 'json.tmp'): string {
    return path.join(this.dir, `${uploadId}.${ext}`);
  }

  private async writeRecord(record: UploadSessionRecord): Promise<void> {
    const tmp = this.filePath(record.uploadId, 'json.tmp');
    await fs.writeFile(tmp, JSON.stringify(record));
    await fs.rename(tmp, this.filePath(record.uploadId, 'json'));
  }

  /** Lateral ausente ou ilegível conta como inexistente — a limpeza recolhe pelo `mtime`. */
  private async readRecord(uploadId: string): Promise<UploadSessionRecord | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath(uploadId, 'json'), 'utf8');
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
    try {
      return JSON.parse(raw) as UploadSessionRecord;
    } catch {
      return null;
    }
  }

  private async readAllRecords(): Promise<UploadSessionRecord[]> {
    const records: UploadSessionRecord[] = [];
    for (const uploadId of (await this.listUploadFiles()).keys()) {
      const record = await this.readRecord(uploadId);
      if (record) records.push(record);
    }
    return records;
  }

  /** Arquivos da pasta agrupados por upload; nomes fora do padrão são ignorados. */
  private async listUploadFiles(): Promise<Map<string, string[]>> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch (err) {
      if (isNotFound(err)) return new Map();
      throw err;
    }
    const byUpload = new Map<string, string[]>();
    for (const name of names) {
      const match = UPLOAD_FILE.exec(name);
      if (!match) continue;
      const uploadId = match[1] as string;
      byUpload.set(uploadId, [...(byUpload.get(uploadId) ?? []), name]);
    }
    return byUpload;
  }
}

/**
 * Saída do transcode de voz: na pasta de uploads (mesmo disco da mídia, a promoção é `rename`)
 * e com o nome que a varredura e o descarte reconhecem como parte do upload.
 */
export function uploadVoiceFilePath(dir: string, uploadId: string, ext: string): string {
  return path.join(dir, `${uploadId}.voice.${ext}`);
}

function isOwner(record: UploadSessionRecord, tenantId: string, userId: string): boolean {
  return record.tenantId === tenantId && record.userId === userId;
}

function addPart(parts: number[], index: number): number[] {
  return parts.includes(index) ? parts : [...parts, index].sort((a, b) => a - b);
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

async function openExisting(filePath: string, flags: 'r' | 'r+'): Promise<fs.FileHandle | null> {
  try {
    return await fs.open(filePath, flags);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Arquivo apagado entre a listagem e o `stat` conta como recente: fica para a próxima varredura. */
async function newestMtime(dir: string, files: string[]): Promise<number> {
  const times = await Promise.all(
    files.map((name) =>
      fs.stat(path.join(dir, name)).then(
        (stats) => stats.mtimeMs,
        () => Number.POSITIVE_INFINITY,
      ),
    ),
  );
  return Math.max(...times);
}
