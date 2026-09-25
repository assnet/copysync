import { describe, it, expect, vi } from 'vitest';
import {
  CreateUploadSessionUseCase,
  type CreateUploadSessionInput,
  type CreateUploadSessionSettings,
} from './CreateUploadSessionUseCase';
import {
  InsufficientStorageError,
  MediaProcessorUnavailableError,
  MediaTooLargeError,
} from '../../../../shared/errors/internal/MediaErrors';
import { TooManyRequestsError, ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import type {
  CreateUploadSessionInput as StoreCreateInput,
  IUploadSessionStore,
  UploadDiskStats,
  UploadSessionRecord,
} from '../../domain/contracts/IUploadSessionStore';
import type { MediaCapabilities } from '../../domain/contracts/MediaCapabilities';

const TENANT = 'tenant-1';
const USER = 'user-1';
const NOW = new Date('2026-09-25T12:00:00.000Z');
const CHUNK = 8_388_608;
/** 900 s × 64 KiB — mesmo cálculo do config público. */
const VOICE_MAX = 58_982_400;

/** Disco folgado: nenhuma checagem de espaço interfere quando o teste não mira nela. */
const DISCO_FOLGADO: UploadDiskStats = { totalBytes: 100_000_000_000, freeBytes: 50_000_000_000 };

function makeDeps(overrides?: {
  settings?: Partial<CreateUploadSessionSettings>;
  capabilities?: Partial<MediaCapabilities>;
  openByUser?: number;
  reservedBytes?: number;
  disk?: UploadDiskStats;
}) {
  const settings: CreateUploadSessionSettings = {
    MEDIA_UPLOAD_CHUNK_BYTES: CHUNK,
    MEDIA_MAX_FILES_PER_BATCH: 30,
    MEDIA_MAX_VOICE_SECONDS: 900,
    MEDIA_MAX_IMAGE_BYTES: 16_000_000,
    MEDIA_MAX_INLINE_VIDEO_BYTES: 180_000_000,
    MEDIA_MAX_DOCUMENT_BYTES: 100_000_000,
    MEDIA_UPLOAD_MAX_OPEN_PER_USER: 30,
    MEDIA_UPLOAD_TTL_MINUTES: 120,
    ...overrides?.settings,
  };
  const capabilities: MediaCapabilities = { transcodeVoice: true, probe: true, ...overrides?.capabilities };

  const store = {
    create: vi.fn(async (input: StoreCreateInput): Promise<UploadSessionRecord> => ({
      ...input,
      uploadId: 'up-1',
      totalParts: Math.ceil(input.sizeBytes / input.chunkSizeBytes),
      receivedParts: [],
      state: 'OPEN',
      externalMessageId: null,
      messageId: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })),
    countOpenByUser: vi.fn().mockResolvedValue(overrides?.openByUser ?? 0),
    openReservedBytes: vi.fn().mockResolvedValue(overrides?.reservedBytes ?? 0),
    diskStats: vi.fn().mockResolvedValue(overrides?.disk ?? DISCO_FOLGADO),
  };

  const useCase = new CreateUploadSessionUseCase(
    store as unknown as IUploadSessionStore, settings, capabilities, () => NOW,
  );
  return { useCase, store };
}

const run = (d: ReturnType<typeof makeDeps>, input?: Partial<CreateUploadSessionInput>) =>
  d.useCase.execute({
    tenantId: TENANT, userId: USER, fileName: 'foto.jpg', sizeBytes: 20_000_000, purpose: 'media',
    ...input,
  });

/** Nada foi reservado nem criado: a recusa aconteceu antes de tocar o disco. */
function expectNadaCriado(d: ReturnType<typeof makeDeps>) {
  expect(d.store.create).not.toHaveBeenCalled();
}

describe('CreateUploadSessionUseCase', () => {
  describe('caminho feliz', () => {
    it('cria o upload e devolve plano de partes, lista vazia e expiração pelo TTL', async () => {
      const d = makeDeps();
      const out = await run(d, { declaredMimeType: 'video/mp4' });

      expect(out).toEqual({
        uploadId: 'up-1',
        chunkSizeBytes: CHUNK,
        totalParts: 3,
        receivedParts: [],
        expiresAt: '2026-09-25T14:00:00.000Z',
      });
      expect(d.store.create).toHaveBeenCalledWith({
        tenantId: TENANT,
        userId: USER,
        purpose: 'media',
        fileName: 'foto.jpg',
        declaredMimeType: 'video/mp4',
        sizeBytes: 20_000_000,
        chunkSizeBytes: CHUNK,
      });
    });

    it('grava o nome já sanitizado e o MIME ausente como null', async () => {
      const d = makeDeps();
      await run(d, { fileName: '../../etc/‮passwd.txt' });

      expect(d.store.create).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: 'passwd.txt', declaredMimeType: null }),
      );
    });

    it('conta os abertos do próprio usuário no próprio tenant', async () => {
      const d = makeDeps();
      await run(d);
      expect(d.store.countOpenByUser).toHaveBeenCalledWith(TENANT, USER);
    });
  });

  describe('tamanho declarado', () => {
    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'recusa %s como erro de validação antes de consultar o store',
      async (sizeBytes) => {
        const d = makeDeps();
        await expect(run(d, { sizeBytes })).rejects.toBeInstanceOf(ValidationError);
        expect(d.store.countOpenByUser).not.toHaveBeenCalled();
        expectNadaCriado(d);
      },
    );

    it('aceita 1 byte', async () => {
      const d = makeDeps();
      await expect(run(d, { sizeBytes: 1 })).resolves.toMatchObject({ totalParts: 1 });
    });
  });

  describe('limite por finalidade', () => {
    it('documento: aceita no limite exato e recusa 1 byte acima com 413', async () => {
      await expect(run(makeDeps(), { purpose: 'document', sizeBytes: 100_000_000 })).resolves.toBeDefined();

      const d = makeDeps();
      const erro = await run(d, { purpose: 'document', sizeBytes: 100_000_001 }).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(MediaTooLargeError);
      expect(erro).toMatchObject({
        statusCode: 413,
        meta: { purpose: 'document', sizeBytes: 100_000_001, maxBytes: 100_000_000 },
      });
      expectNadaCriado(d);
    });

    it('mídia: vale o maior entre imagem e vídeo, porque a classificação só vem no consumo', async () => {
      await expect(run(makeDeps(), { sizeBytes: 180_000_000 })).resolves.toBeDefined();
      await expect(run(makeDeps(), { sizeBytes: 180_000_001 })).rejects.toBeInstanceOf(MediaTooLargeError);
    });

    it('mídia: com imagem maior que vídeo, o teto passa a ser o da imagem', async () => {
      const settings = { MEDIA_MAX_IMAGE_BYTES: 200_000_000, MEDIA_MAX_INLINE_VIDEO_BYTES: 50_000_000 };
      await expect(run(makeDeps({ settings }), { sizeBytes: 200_000_000 })).resolves.toBeDefined();
      await expect(run(makeDeps({ settings }), { sizeBytes: 200_000_001 }))
        .rejects.toBeInstanceOf(MediaTooLargeError);
    });

    it('voz: aceita no limite exato e recusa 1 byte acima com 413', async () => {
      await expect(run(makeDeps(), { purpose: 'voice', sizeBytes: VOICE_MAX })).resolves.toBeDefined();
      await expect(run(makeDeps(), { purpose: 'voice', sizeBytes: VOICE_MAX + 1 }))
        .rejects.toBeInstanceOf(MediaTooLargeError);
    });

    it('limite vem antes do disco: nem consulta espaço nem abertos', async () => {
      const d = makeDeps({ disk: { totalBytes: 1_000, freeBytes: 0 }, openByUser: 999 });
      await expect(run(d, { sizeBytes: 999_999_999 })).rejects.toBeInstanceOf(MediaTooLargeError);
      expect(d.store.countOpenByUser).not.toHaveBeenCalled();
      expect(d.store.diskStats).not.toHaveBeenCalled();
      expect(d.store.openReservedBytes).not.toHaveBeenCalled();
    });
  });

  describe('voz sem processador', () => {
    it('recusa com 503 antes de contar abertos ou medir o disco', async () => {
      const d = makeDeps({ capabilities: { transcodeVoice: false }, disk: { totalBytes: 1_000, freeBytes: 0 } });
      const erro = await run(d, { purpose: 'voice', sizeBytes: 1_000 }).catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(MediaProcessorUnavailableError);
      expect(erro).toMatchObject({ statusCode: 503 });
      expect(d.store.countOpenByUser).not.toHaveBeenCalled();
      expect(d.store.diskStats).not.toHaveBeenCalled();
      expectNadaCriado(d);
    });

    it('voz acima do limite sem processador ainda é 413: o tamanho é checado primeiro', async () => {
      const d = makeDeps({ capabilities: { transcodeVoice: false } });
      await expect(run(d, { purpose: 'voice', sizeBytes: VOICE_MAX + 1 }))
        .rejects.toBeInstanceOf(MediaTooLargeError);
    });

    it('sem processador, mídia e documento continuam aceitos', async () => {
      const capabilities = { transcodeVoice: false };
      await expect(run(makeDeps({ capabilities }))).resolves.toBeDefined();
      await expect(run(makeDeps({ capabilities }), { purpose: 'document' })).resolves.toBeDefined();
    });
  });

  describe('uploads abertos por usuário', () => {
    it('aceita com um a menos que o teto', async () => {
      await expect(run(makeDeps({ openByUser: 29 }))).resolves.toBeDefined();
    });

    it('no teto recusa com 429 antes de medir o disco', async () => {
      const d = makeDeps({ openByUser: 30 });
      const erro = await run(d).catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(TooManyRequestsError);
      expect(erro).toMatchObject({ statusCode: 429 });
      expect(d.store.diskStats).not.toHaveBeenCalled();
      expectNadaCriado(d);
    });
  });

  describe('reserva de disco', () => {
    /** Reserva e teto fixados por env para os números ficarem legíveis. */
    const fixos = { MEDIA_DISK_RESERVE_BYTES: 200, MEDIA_UPLOAD_MAX_OPEN_BYTES: 1_000_000 };

    it('aceita quando livre − reservado − tamanho fica exatamente na reserva', async () => {
      const d = makeDeps({ settings: fixos, disk: { totalBytes: 10_000, freeBytes: 1_000 }, reservedBytes: 300 });
      await expect(run(d, { sizeBytes: 500 })).resolves.toBeDefined();
    });

    it('recusa com 507 quando sobra 1 byte a menos que a reserva', async () => {
      const d = makeDeps({ settings: fixos, disk: { totalBytes: 10_000, freeBytes: 1_000 }, reservedBytes: 300 });
      const erro = await run(d, { sizeBytes: 501 }).catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(InsufficientStorageError);
      expect(erro).toMatchObject({ statusCode: 507 });
      expectNadaCriado(d);
    });

    it('aceita quando a soma aberta fica exatamente no teto', async () => {
      const settings = { MEDIA_DISK_RESERVE_BYTES: 0, MEDIA_UPLOAD_MAX_OPEN_BYTES: 1_000 };
      const d = makeDeps({ settings, reservedBytes: 400 });
      await expect(run(d, { sizeBytes: 600 })).resolves.toBeDefined();
    });

    it('recusa com 507 quando a soma aberta passa 1 byte do teto, mesmo com disco livre', async () => {
      const settings = { MEDIA_DISK_RESERVE_BYTES: 0, MEDIA_UPLOAD_MAX_OPEN_BYTES: 1_000 };
      const d = makeDeps({ settings, reservedBytes: 400 });
      await expect(run(d, { sizeBytes: 601 })).rejects.toBeInstanceOf(InsufficientStorageError);
      expectNadaCriado(d);
    });

    it('sem env, reserva e teto saem do tamanho do disco (974 MB de produção)', async () => {
      // Reserva = max(100 MiB, 10%) = 104_857_600; teto = min(2 GB, 50%) = 487_000_000.
      const disk = { totalBytes: 974_000_000, freeBytes: 287_000_000 };
      await expect(run(makeDeps({ disk }), { sizeBytes: 180_000_000 })).resolves.toBeDefined();
      await expect(run(makeDeps({ disk, reservedBytes: 10_000_000 }), { sizeBytes: 180_000_000 }))
        .rejects.toBeInstanceOf(InsufficientStorageError);
    });

    it('reserva configurada por env vence a calculada', async () => {
      const disk = { totalBytes: 974_000_000, freeBytes: 287_000_000 };
      const d = makeDeps({ disk, reservedBytes: 10_000_000, settings: { MEDIA_DISK_RESERVE_BYTES: 0 } });
      await expect(run(d, { sizeBytes: 180_000_000 })).resolves.toBeDefined();
    });
  });
});
