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
  UploadSessionState,
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

function padroes(overrides?: Partial<CreateUploadSessionSettings>): CreateUploadSessionSettings {
  return {
    MEDIA_UPLOAD_CHUNK_BYTES: CHUNK,
    MEDIA_MAX_FILES_PER_BATCH: 30,
    MEDIA_MAX_VOICE_SECONDS: 900,
    MEDIA_MAX_IMAGE_BYTES: 16_000_000,
    MEDIA_MAX_INLINE_VIDEO_BYTES: 180_000_000,
    MEDIA_MAX_DOCUMENT_BYTES: 100_000_000,
    MEDIA_UPLOAD_MAX_OPEN_PER_USER: 30,
    MEDIA_UPLOAD_TTL_MINUTES: 120,
    ...overrides,
  };
}

/** Upload já existente no store — só o que as contas de bytes leem. */
type Existente = Pick<UploadSessionRecord, 'tenantId' | 'userId' | 'sizeBytes' | 'state'>;

function registro(input: StoreCreateInput, uploadId = 'up-1'): UploadSessionRecord {
  return {
    ...input,
    uploadId,
    totalParts: Math.ceil(input.sizeBytes / input.chunkSizeBytes),
    receivedParts: [],
    state: 'OPEN',
    externalMessageId: null,
    messageId: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function makeDeps(overrides?: {
  settings?: Partial<CreateUploadSessionSettings>;
  capabilities?: Partial<MediaCapabilities>;
  openByUser?: number;
  reservedBytes?: number;
  disk?: UploadDiskStats;
  existentes?: Existente[];
}) {
  const settings = padroes(overrides?.settings);
  const capabilities: MediaCapabilities = { transcodeVoice: true, probe: true, ...overrides?.capabilities };

  const existentes = overrides?.existentes ?? [];
  const store = {
    create: vi.fn(async (input: StoreCreateInput): Promise<UploadSessionRecord> => registro(input)),
    countOpenByUser: vi.fn().mockResolvedValue(overrides?.openByUser ?? 0),
    openReservedBytes: vi.fn().mockResolvedValue(overrides?.reservedBytes ?? 0),
    diskStats: vi.fn().mockResolvedValue(overrides?.disk ?? DISCO_FOLGADO),
    listByState: vi.fn(async (state: UploadSessionState) =>
      existentes
        .filter((e) => e.state === state)
        .map((e, i) => ({ ...registro({ ...e, purpose: 'media', fileName: 'x', declaredMimeType: null, chunkSizeBytes: CHUNK }, `ex-${i}`), state: e.state }))),
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
      expect(d.store.listByState).not.toHaveBeenCalled();
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

    it('com ffmpeg mas sem ffprobe também recusa com 503: a confirmação exige os dois', async () => {
      const d = makeDeps({ capabilities: { transcodeVoice: true, probe: false } });
      const erro = await run(d, { purpose: 'voice', sizeBytes: 1_000 }).catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(MediaProcessorUnavailableError);
      expectNadaCriado(d);
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

    /** Teto por usuário folgado: estes casos miram só o teto global. */
    const soGlobal = { MEDIA_DISK_RESERVE_BYTES: 0, MEDIA_UPLOAD_MAX_OPEN_BYTES: 1_000, MEDIA_UPLOAD_MAX_OPEN_BYTES_PER_USER: 1_000_000 };

    it('aceita quando a soma aberta fica exatamente no teto', async () => {
      const settings = soGlobal;
      const d = makeDeps({ settings, reservedBytes: 400 });
      await expect(run(d, { sizeBytes: 600 })).resolves.toBeDefined();
    });

    it('recusa com 507 quando a soma aberta passa 1 byte do teto, mesmo com disco livre', async () => {
      const settings = soGlobal;
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

  describe('bytes abertos por usuário', () => {
    /** Global folgado: só o teto por usuário decide. */
    const global = { MEDIA_DISK_RESERVE_BYTES: 0, MEDIA_UPLOAD_MAX_OPEN_BYTES: 1_000_000 };
    const meus: Existente[] = [
      { tenantId: TENANT, userId: USER, sizeBytes: 200, state: 'OPEN' },
      { tenantId: TENANT, userId: USER, sizeBytes: 100, state: 'CONSUMING' },
    ];
    /** Não contam: outro usuário, mesmo usuário em outro tenant e upload já consumido. */
    const alheios: Existente[] = [
      { tenantId: TENANT, userId: 'user-2', sizeBytes: 900, state: 'OPEN' },
      { tenantId: 'tenant-2', userId: USER, sizeBytes: 900, state: 'OPEN' },
      { tenantId: TENANT, userId: USER, sizeBytes: 900, state: 'CONSUMED' },
    ];
    const comTeto = (teto: number) => ({ ...global, MEDIA_UPLOAD_MAX_OPEN_BYTES_PER_USER: teto });

    it('aceita quando abertos + consumindo + novo fica exatamente no teto', async () => {
      const d = makeDeps({ settings: comTeto(500), existentes: [...meus, ...alheios] });
      await expect(run(d, { sizeBytes: 200 })).resolves.toBeDefined();
      expect(d.store.listByState).toHaveBeenCalledWith('OPEN');
      expect(d.store.listByState).toHaveBeenCalledWith('CONSUMING');
    });

    it('recusa com 429 1 byte acima do teto, sem criar', async () => {
      const d = makeDeps({ settings: comTeto(500), existentes: [...meus, ...alheios] });
      const erro = await run(d, { sizeBytes: 201 }).catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(TooManyRequestsError);
      expect(erro).toMatchObject({ statusCode: 429 });
      expectNadaCriado(d);
    });

    it('o que é de outro usuário ou de outro tenant não consome o teto de ninguém', async () => {
      const d = makeDeps({ settings: comTeto(500), existentes: alheios });
      await expect(run(d, { sizeBytes: 500 })).resolves.toBeDefined();
    });

    it('sem env, o teto é metade do teto global — inclusive quando o global vem por env', async () => {
      const settings = { MEDIA_DISK_RESERVE_BYTES: 0, MEDIA_UPLOAD_MAX_OPEN_BYTES: 1_000 };
      await expect(run(makeDeps({ settings, existentes: meus }), { sizeBytes: 200 })).resolves.toBeDefined();
      await expect(run(makeDeps({ settings, existentes: meus }), { sizeBytes: 201 }))
        .rejects.toBeInstanceOf(TooManyRequestsError);
    });

    it('sem env nenhuma, o teto sai do disco: metade de min(2 GB, 50%)', async () => {
      // Global = min(2 GB, 1 GB) = 1_000_000_000 → por usuário = 500_000_000.
      const disk = { totalBytes: 2_000_000_000, freeBytes: 2_000_000_000 };
      const cheio: Existente[] = [{ tenantId: TENANT, userId: USER, sizeBytes: 320_000_000, state: 'OPEN' }];
      const passou: Existente[] = [{ tenantId: TENANT, userId: USER, sizeBytes: 320_000_001, state: 'OPEN' }];

      await expect(run(makeDeps({ disk, existentes: cheio }), { sizeBytes: 180_000_000 })).resolves.toBeDefined();
      await expect(run(makeDeps({ disk, existentes: passou }), { sizeBytes: 180_000_000 }))
        .rejects.toBeInstanceOf(TooManyRequestsError);
    });

    it('o teto do usuário vem antes do disco: quem acumula recebe 429, não 507', async () => {
      const d = makeDeps({
        settings: { MEDIA_DISK_RESERVE_BYTES: 0, MEDIA_UPLOAD_MAX_OPEN_BYTES: 400, MEDIA_UPLOAD_MAX_OPEN_BYTES_PER_USER: 300 },
        existentes: meus,
        reservedBytes: 300,
      });
      await expect(run(d, { sizeBytes: 200 })).rejects.toBeInstanceOf(TooManyRequestsError);
    });
  });

  describe('criações concorrentes', () => {
    /**
     * Store em memória que reflete as criações nas contas — e demora a criar, para as duas
     * checagens terminarem antes de qualquer `create` se nada as serializar.
     */
    function storeEmMemoria(disk: UploadDiskStats) {
      const criados: UploadSessionRecord[] = [];
      let seq = 0;
      const soma = (lista: UploadSessionRecord[]) => lista.reduce((t, r) => t + r.sizeBytes, 0);
      const store = {
        create: vi.fn(async (input: StoreCreateInput) => {
          await new Promise((r) => setTimeout(r, 5));
          const record = registro(input, `up-${++seq}`);
          criados.push(record);
          return record;
        }),
        countOpenByUser: vi.fn(async (t: string, u: string) =>
          criados.filter((r) => r.tenantId === t && r.userId === u).length),
        openReservedBytes: vi.fn(async () => soma(criados)),
        diskStats: vi.fn(async () => disk),
        listByState: vi.fn(async (state: UploadSessionState) => criados.filter((r) => r.state === state)),
      };
      return { store, criados };
    }

    function useCaseCom(store: unknown, settings: Partial<CreateUploadSessionSettings>, capabilities?: Partial<MediaCapabilities>) {
      return new CreateUploadSessionUseCase(
        store as IUploadSessionStore, padroes(settings), { transcodeVoice: true, probe: true, ...capabilities }, () => NOW,
      );
    }

    const entrada = (userId: string): CreateUploadSessionInput => ({
      tenantId: TENANT, userId, fileName: 'a.mp4', sizeBytes: 600, purpose: 'media',
    });

    it('duas criações em paralelo que não cabem juntas no teto global: só uma passa (507 na outra)', async () => {
      const { store, criados } = storeEmMemoria(DISCO_FOLGADO);
      const settings = { MEDIA_DISK_RESERVE_BYTES: 0, MEDIA_UPLOAD_MAX_OPEN_BYTES: 1_000, MEDIA_UPLOAD_MAX_OPEN_BYTES_PER_USER: 1_000 };
      // Instâncias distintas, como a rota faz por requisição: o mutex é do módulo, não da instância.
      const resultados = await Promise.allSettled([
        useCaseCom(store, settings).execute(entrada(USER)),
        useCaseCom(store, settings).execute(entrada('user-2')),
      ]);

      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const recusa = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(recusa.reason).toBeInstanceOf(InsufficientStorageError);
      expect(criados).toHaveLength(1);
    });

    it('duas criações em paralelo do mesmo usuário que não cabem no teto dele: só uma passa (429 na outra)', async () => {
      const { store, criados } = storeEmMemoria(DISCO_FOLGADO);
      const settings = { MEDIA_DISK_RESERVE_BYTES: 0, MEDIA_UPLOAD_MAX_OPEN_BYTES: 1_000_000, MEDIA_UPLOAD_MAX_OPEN_BYTES_PER_USER: 1_000 };
      const resultados = await Promise.allSettled([
        useCaseCom(store, settings).execute(entrada(USER)),
        useCaseCom(store, settings).execute(entrada(USER)),
      ]);

      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const recusa = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(recusa.reason).toBeInstanceOf(TooManyRequestsError);
      expect(criados).toHaveLength(1);
    });

    it('duas criações em paralelo no limite de abertos por quantidade: só uma passa', async () => {
      const { store, criados } = storeEmMemoria(DISCO_FOLGADO);
      const settings = { MEDIA_UPLOAD_MAX_OPEN_PER_USER: 1 };
      const resultados = await Promise.allSettled([
        useCaseCom(store, settings).execute({ ...entrada(USER), sizeBytes: 10 }),
        useCaseCom(store, settings).execute({ ...entrada(USER), sizeBytes: 10 }),
      ]);

      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(criados).toHaveLength(1);
    });

    it('uma falha do store não trava as criações seguintes', async () => {
      const { store } = storeEmMemoria(DISCO_FOLGADO);
      store.create.mockRejectedValueOnce(new Error('disco sumiu'));
      const useCase = useCaseCom(store, {});

      await expect(useCase.execute(entrada(USER))).rejects.toThrow('disco sumiu');
      await expect(useCase.execute(entrada(USER))).resolves.toMatchObject({ uploadId: 'up-1' });
    });

    it('recusas baratas (tamanho, limite, voz) não esperam a fila', async () => {
      const { store } = storeEmMemoria(DISCO_FOLGADO);
      let liberar!: () => void;
      store.diskStats.mockImplementationOnce(() => new Promise((r) => { liberar = () => r(DISCO_FOLGADO); }));
      const lenta = useCaseCom(store, {}).execute(entrada(USER));
      await vi.waitFor(() => expect(store.diskStats).toHaveBeenCalled());

      // Com a fila ocupada pela criação acima, a recusa barata sai mesmo assim.
      await expect(useCaseCom(store, {}).execute({ ...entrada(USER), sizeBytes: 0 })).rejects.toBeInstanceOf(ValidationError);
      await expect(useCaseCom(store, {}, { probe: false }).execute({ ...entrada(USER), purpose: 'voice' }))
        .rejects.toBeInstanceOf(MediaProcessorUnavailableError);

      liberar();
      await expect(lenta).resolves.toBeDefined();
    });
  });
});
