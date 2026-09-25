import type {
  IUploadSessionStore,
  UploadPurpose,
  UploadSessionRecord,
  UploadSessionState,
} from '../../domain/contracts/IUploadSessionStore';
import type { MediaCapabilities } from '../../domain/contracts/MediaCapabilities';
import {
  buildMediaUploadConfig,
  type MediaUploadConfig,
  type MediaUploadSettings,
} from '../../domain/services/mediaUploadConfig';
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
  /** Sem valor, metade do teto de abertos — um usuário nunca esgota a reserva dos outros tenants. */
  MEDIA_UPLOAD_MAX_OPEN_BYTES_PER_USER?: number;
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

/** Estados que ainda seguram bytes declarados: o `.bin` existe e a mensagem ainda não. */
const HOLDING_STATES: readonly UploadSessionState[] = ['OPEN', 'CONSUMING'];

/**
 * Fila do processo para checagens + `create`. Sem ela, POSTs paralelos leem o mesmo estado,
 * todos passam e juntos furam os tetos. Fica no módulo, não na instância: a rota cria um use
 * case por requisição. Vale para um processo só (disco local da Render); vários processos no
 * mesmo disco precisariam de trava no próprio store.
 */
let creationQueue: Promise<unknown> = Promise.resolve();

function inCreationQueue<T>(task: () => Promise<T>): Promise<T> {
  const run = creationQueue.then(task);
  // A próxima criação espera esta terminar, com sucesso ou erro — uma falha não trava a fila.
  creationQueue = run.catch(() => undefined);
  return run;
}

/**
 * Abre um upload em partes (design §5).
 *
 * Ordem importa: nome → tamanho válido → limite da finalidade (413) → voz sem ffmpeg/ffprobe
 * (503) → **fila** → abertos do usuário (429) → bytes abertos do usuário (429) → disco (507) →
 * cria. As recusas baratas vêm antes da fila e de ler o disco; nada é gravado antes de todas
 * passarem, e da primeira leitura do store até o `create` só uma criação roda por vez.
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

    const config = buildMediaUploadConfig(this.settings, this.capabilities);
    const maxBytes = maxBytesFor(purpose, config.limits);
    if (sizeBytes > maxBytes) {
      throw new MediaTooLargeError(undefined, { purpose, sizeBytes, maxBytes });
    }

    // Mesma regra do config público: o painel só mostra o gravador quando a confirmação aceitaria.
    if (purpose === 'voice' && !config.capabilities.voiceNotes) {
      throw new MediaProcessorUnavailableError('Voice notes are unavailable on this server');
    }

    const record = await inCreationQueue(async () => {
      const openByUser = await this.store.countOpenByUser(tenantId, userId);
      if (openByUser >= this.settings.MEDIA_UPLOAD_MAX_OPEN_PER_USER) {
        throw new TooManyRequestsError('Too many open uploads for this user');
      }

      await this.ensureRoom(tenantId, userId, sizeBytes);

      return this.store.create({
        tenantId,
        userId,
        purpose,
        fileName,
        declaredMimeType: input.declaredMimeType ?? null,
        sizeBytes,
        chunkSizeBytes: this.settings.MEDIA_UPLOAD_CHUNK_BYTES,
      });
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
   * Bytes declarados dos uploads abertos contam como ocupados: o `.bin` esparso ainda não
   * gastou esses blocos. A reserva protege a mídia recebida, que grava no mesmo disco.
   *
   * O teto do usuário vem antes do global: sem ele, um usuário de um tenant enche a reserva e
   * todos os outros tenants recebem 507. Quem acumula recebe 429; o disco cheio de fato, 507.
   */
  private async ensureRoom(tenantId: string, userId: string, sizeBytes: number): Promise<void> {
    const [{ totalBytes, freeBytes }, reservedBytes, userBytes] = await Promise.all([
      this.store.diskStats(),
      this.store.openReservedBytes(),
      this.openBytesOf(tenantId, userId),
    ]);
    const budget = diskBudget({
      totalBytes,
      reserveBytes: this.settings.MEDIA_DISK_RESERVE_BYTES,
      maxOpenBytes: this.settings.MEDIA_UPLOAD_MAX_OPEN_BYTES,
    });

    const maxUserBytes = this.settings.MEDIA_UPLOAD_MAX_OPEN_BYTES_PER_USER ?? Math.floor(budget.maxOpenBytes / 2);
    if (userBytes + sizeBytes > maxUserBytes) {
      throw new TooManyRequestsError('Too many open upload bytes for this user');
    }

    const leftAfter = freeBytes - reservedBytes - sizeBytes;
    if (leftAfter < budget.reserveBytes || reservedBytes + sizeBytes > budget.maxOpenBytes) {
      throw new InsufficientStorageError(undefined, { sizeBytes });
    }
  }

  /** Soma declarada dos uploads `OPEN`/`CONSUMING` do usuário no tenant. */
  private async openBytesOf(tenantId: string, userId: string): Promise<number> {
    const lists = await Promise.all(HOLDING_STATES.map((state) => this.store.listByState(state)));
    return lists
      .flat()
      .filter((record: UploadSessionRecord) => record.tenantId === tenantId && record.userId === userId)
      .reduce((total, record) => total + record.sizeBytes, 0);
  }
}

/**
 * `media` ainda não sabe se é imagem ou vídeo — a classificação só acontece no consumo,
 * pelo conteúdo. Por isso vale o maior dos dois; o consumo aplica o limite do tipo real.
 */
function maxBytesFor(purpose: UploadPurpose, limits: MediaUploadConfig['limits']): number {
  switch (purpose) {
    case 'document':
      return limits.documentBytes;
    case 'voice':
      return limits.voiceBytes;
    case 'media':
      return Math.max(limits.imageBytes, limits.inlineVideoBytes);
  }
}
