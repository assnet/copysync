import type { IUploadSessionStore, UploadPurpose } from '../../domain/contracts/IUploadSessionStore';
import type { MediaCapabilities } from '../../domain/contracts/MediaCapabilities';
import { buildMediaUploadConfig, type MediaUploadSettings } from '../../domain/services/mediaUploadConfig';
import { diskBudget } from '../../domain/services/diskBudget';
import { sanitizeFileName } from '../../domain/services/sanitizeFileName';
import {
  InsufficientStorageError,
  MediaProcessorUnavailableError,
  MediaTooLargeError,
} from '../../../../shared/errors/internal/MediaErrors';
import { TooManyRequestsError, ValidationError } from '../../../../shared/errors/internal/ResourceErrors';

/** Recorte do `env` usado na criação — nomes iguais aos das variáveis, como em `MediaUploadSettings`. */
export interface CreateUploadSessionSettings extends MediaUploadSettings {
  MEDIA_UPLOAD_MAX_OPEN_PER_USER: number;
  MEDIA_UPLOAD_TTL_MINUTES: number;
  /** Sem valor, a reserva sai do tamanho do disco (`diskBudget`). */
  MEDIA_DISK_RESERVE_BYTES?: number;
  /** Sem valor, o teto de abertos sai do tamanho do disco (`diskBudget`). */
  MEDIA_UPLOAD_MAX_OPEN_BYTES?: number;
}

export interface CreateUploadSessionInput {
  tenantId: string;
  userId: string;
  fileName: string;
  sizeBytes: number;
  purpose: UploadPurpose;
  declaredMimeType?: string | null;
}

/** Resposta de `POST /media/uploads`. */
export interface CreateUploadSessionOutput {
  uploadId: string;
  chunkSizeBytes: number;
  totalParts: number;
  receivedParts: number[];
  /** ISO — a limpeza apaga o upload parado depois disso. */
  expiresAt: string;
}

/**
 * Abre um upload em partes (design §5).
 *
 * Ordem importa: nome → tamanho válido → limite da finalidade (413) → voz sem ffmpeg (503) →
 * abertos do usuário (429) → disco (507) → cria. As recusas baratas vêm antes de ler o disco,
 * e nada é gravado antes de todas passarem.
 */
export class CreateUploadSessionUseCase {
  constructor(
    private readonly store: IUploadSessionStore,
    private readonly settings: CreateUploadSessionSettings,
    private readonly capabilities: MediaCapabilities,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: CreateUploadSessionInput): Promise<CreateUploadSessionOutput> {
    const { tenantId, userId, sizeBytes, purpose } = input;
    const fileName = sanitizeFileName(input.fileName);

    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      throw new ValidationError('Upload size must be a positive integer', { sizeBytes });
    }

    const maxBytes = this.maxBytesFor(purpose);
    if (sizeBytes > maxBytes) {
      throw new MediaTooLargeError(undefined, { purpose, sizeBytes, maxBytes });
    }

    if (purpose === 'voice' && !this.capabilities.transcodeVoice) {
      throw new MediaProcessorUnavailableError('Voice notes are unavailable on this server');
    }

    const openByUser = await this.store.countOpenByUser(tenantId, userId);
    if (openByUser >= this.settings.MEDIA_UPLOAD_MAX_OPEN_PER_USER) {
      throw new TooManyRequestsError('Too many open uploads for this user');
    }

    await this.ensureDiskRoom(sizeBytes);

    const record = await this.store.create({
      tenantId,
      userId,
      purpose,
      fileName,
      declaredMimeType: input.declaredMimeType ?? null,
      sizeBytes,
      chunkSizeBytes: this.settings.MEDIA_UPLOAD_CHUNK_BYTES,
    });

    const ttlMs = this.settings.MEDIA_UPLOAD_TTL_MINUTES * 60_000;
    return {
      uploadId: record.uploadId,
      chunkSizeBytes: record.chunkSizeBytes,
      totalParts: record.totalParts,
      receivedParts: record.receivedParts,
      expiresAt: new Date(this.now().getTime() + ttlMs).toISOString(),
    };
  }

  /**
   * `media` ainda não sabe se é imagem ou vídeo — a classificação só acontece no consumo,
   * pelo conteúdo. Por isso vale o maior dos dois; o consumo aplica o limite do tipo real.
   */
  private maxBytesFor(purpose: UploadPurpose): number {
    const { limits } = buildMediaUploadConfig(this.settings, this.capabilities);
    switch (purpose) {
      case 'document':
        return limits.documentBytes;
      case 'voice':
        return limits.voiceBytes;
      case 'media':
        return Math.max(limits.imageBytes, limits.inlineVideoBytes);
    }
  }

  /**
   * Bytes declarados dos uploads abertos contam como ocupados: o `.bin` esparso ainda não
   * gastou esses blocos. A reserva protege a mídia recebida, que grava no mesmo disco.
   */
  private async ensureDiskRoom(sizeBytes: number): Promise<void> {
    const [{ totalBytes, freeBytes }, reservedBytes] = await Promise.all([
      this.store.diskStats(),
      this.store.openReservedBytes(),
    ]);
    const budget = diskBudget({
      totalBytes,
      reserveBytes: this.settings.MEDIA_DISK_RESERVE_BYTES,
      maxOpenBytes: this.settings.MEDIA_UPLOAD_MAX_OPEN_BYTES,
    });

    const leftAfter = freeBytes - reservedBytes - sizeBytes;
    if (leftAfter < budget.reserveBytes || reservedBytes + sizeBytes > budget.maxOpenBytes) {
      throw new InsufficientStorageError(undefined, { sizeBytes });
    }
  }
}
