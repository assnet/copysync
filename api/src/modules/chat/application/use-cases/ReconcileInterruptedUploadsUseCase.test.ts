import { describe, it, expect, vi } from 'vitest';
import { ReconcileInterruptedUploadsUseCase } from './ReconcileInterruptedUploadsUseCase';
import { logger } from '../../../../shared/logger/logger';
import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type {
  IUploadSessionStore,
  UploadSessionRecord,
} from '../../../media/domain/contracts/IUploadSessionStore';

vi.mock('../../../../shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function upload(uploadId: string, over: Partial<UploadSessionRecord> = {}): UploadSessionRecord {
  return {
    uploadId, tenantId: 'tenant-1', userId: 'user-1', purpose: 'media',
    fileName: 'foto.jpg', declaredMimeType: 'image/jpeg', sizeBytes: 1_000,
    chunkSizeBytes: 1_000, totalParts: 1, receivedParts: [0],
    state: 'CONSUMING', externalMessageId: null, messageId: null,
    createdAt: '2026-09-25T11:00:00.000Z', updatedAt: '2026-09-25T11:00:00.000Z',
    ...over,
  };
}

function makeUseCase(opts: {
  consumindo: UploadSessionRecord[];
  /** Mensagens gravadas, por `externalMessageId` (tenant na chave para provar o filtro). */
  mensagens?: Record<string, { id: string }>;
  /** Uploads cujo `.bin` ainda está na pasta de uploads (os demais foram promovidos). */
  comArquivo?: string[];
  falhaLista?: boolean;
}) {
  const comArquivo = new Set(opts.comArquivo ?? []);
  const mensagens = opts.mensagens ?? {};
  const findByExternalId = vi.fn().mockImplementation(
    async (externalId: string, tenantId: string) => mensagens[`${tenantId}:${externalId}`] ?? null,
  );
  // Registra qualquer acesso ao repositório: a reconciliação só pode ler por id externo.
  const acessosRepo: string[] = [];
  const messageRepo = new Proxy({ findByExternalId } as unknown as IChatMessageRepository, {
    get: (alvo, prop) => {
      acessosRepo.push(String(prop));
      return Reflect.get(alvo, prop);
    },
  });
  const uploads = {
    listByState: opts.falhaLista
      ? vi.fn().mockRejectedValue(new Error('pasta ilegível'))
      : vi.fn().mockResolvedValue(opts.consumindo),
    finishConsume: vi.fn().mockResolvedValue(null),
    releaseConsume: vi.fn().mockResolvedValue(null),
    discard: vi.fn().mockResolvedValue(undefined),
    dropBinary: vi.fn().mockResolvedValue(undefined),
    readHead: vi.fn(async (uploadId: string) => (comArquivo.has(uploadId) ? new Uint8Array([1]) : null)),
  };
  const useCase = new ReconcileInterruptedUploadsUseCase(
    uploads as unknown as IUploadSessionStore,
    messageRepo,
  );
  return { useCase, uploads, findByExternalId, acessosRepo };
}

describe('ReconcileInterruptedUploadsUseCase', () => {
  it('só olha uploads que estavam virando mensagem quando o processo caiu', async () => {
    const { useCase, uploads } = makeUseCase({ consumindo: [] });

    await useCase.execute();

    expect(uploads.listByState).toHaveBeenCalledWith('CONSUMING');
  });

  it('upload cuja mensagem chegou a ser gravada é dado como consumido, apontando para ela', async () => {
    const { useCase, uploads, findByExternalId } = makeUseCase({
      consumindo: [upload('up-1', { externalMessageId: 'EXT-1' })],
      mensagens: { 'tenant-1:EXT-1': { id: 'msg-1' } },
    });

    await useCase.execute();

    expect(findByExternalId).toHaveBeenCalledWith('EXT-1', 'tenant-1');
    expect(uploads.finishConsume).toHaveBeenCalledWith('up-1', 'msg-1');
    expect(uploads.discard).not.toHaveBeenCalled();
    expect(uploads.releaseConsume).not.toHaveBeenCalled();
  });

  it('procura a mensagem só no tenant do upload', async () => {
    const { useCase, uploads } = makeUseCase({
      consumindo: [upload('up-1', { tenantId: 'tenant-2', externalMessageId: 'EXT-1' })],
      mensagens: { 'tenant-1:EXT-1': { id: 'msg-de-outro-tenant' } },
    });

    await useCase.execute();

    expect(uploads.finishConsume).not.toHaveBeenCalled();
    expect(uploads.discard).toHaveBeenCalledWith('up-1');
  });

  it('upload promovido sem mensagem gravada é descartado (o painel sobe o arquivo de novo)', async () => {
    const { useCase, uploads } = makeUseCase({
      consumindo: [upload('up-1', { externalMessageId: 'EXT-1' })],
    });

    await useCase.execute();

    expect(uploads.discard).toHaveBeenCalledWith('up-1');
    expect(uploads.finishConsume).not.toHaveBeenCalled();
    expect(uploads.releaseConsume).not.toHaveBeenCalled();
    // O arquivo já promovido não tem caminho derivável daqui: fica registrado no log
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ uploadId: 'up-1', externalMessageId: 'EXT-1' }),
      expect.any(String),
    );
  });

  it('upload sem mensagem mas com o arquivo intacto volta a aceitar a confirmação, sem descartar', async () => {
    const { useCase, uploads } = makeUseCase({
      consumindo: [upload('up-1', { externalMessageId: 'EXT-1' })],
      comArquivo: ['up-1'],
    });

    await useCase.execute();

    expect(uploads.readHead).toHaveBeenCalledWith('up-1', expect.any(Number));
    expect(uploads.releaseConsume).toHaveBeenCalledWith('up-1');
    expect(uploads.discard).not.toHaveBeenCalled();
    expect(uploads.finishConsume).not.toHaveBeenCalled();
  });

  it('nota de voz concluída no boot também apaga o original, que a promoção não levou', async () => {
    const { useCase, uploads } = makeUseCase({
      consumindo: [
        upload('voz', { purpose: 'voice', externalMessageId: 'EXT-1' }),
        upload('foto', { externalMessageId: 'EXT-2' }),
      ],
      mensagens: { 'tenant-1:EXT-1': { id: 'msg-1' }, 'tenant-1:EXT-2': { id: 'msg-2' } },
    });

    await useCase.execute();

    expect(uploads.finishConsume).toHaveBeenCalledWith('voz', 'msg-1');
    expect(uploads.dropBinary).toHaveBeenCalledTimes(1);
    expect(uploads.dropBinary).toHaveBeenCalledWith('voz');
  });

  it('upload que caiu antes de receber o id do WhatsApp volta a aceitar a confirmação', async () => {
    const { useCase, uploads, findByExternalId } = makeUseCase({
      consumindo: [upload('up-1', { externalMessageId: null })],
    });

    await useCase.execute();

    expect(uploads.releaseConsume).toHaveBeenCalledWith('up-1');
    expect(findByExternalId).not.toHaveBeenCalled();
    expect(uploads.discard).not.toHaveBeenCalled();
    expect(uploads.finishConsume).not.toHaveBeenCalled();
  });

  it('nunca escreve no banco: só busca a mensagem pelo id externo', async () => {
    const { useCase, acessosRepo } = makeUseCase({
      consumindo: [
        upload('up-1', { externalMessageId: 'EXT-1' }),
        upload('up-2', { externalMessageId: 'EXT-2' }),
        upload('up-3', { externalMessageId: null }),
      ],
      mensagens: { 'tenant-1:EXT-1': { id: 'msg-1' } },
    });

    await useCase.execute();

    expect(new Set(acessosRepo)).toEqual(new Set(['findByExternalId']));
  });

  it('erro em um upload vai para o log e não impede os demais', async () => {
    const { useCase, uploads, findByExternalId } = makeUseCase({
      consumindo: [
        upload('up-1', { externalMessageId: 'EXT-1' }),
        upload('up-2', { externalMessageId: 'EXT-2' }),
        upload('up-3', { externalMessageId: null }),
      ],
      mensagens: { 'tenant-1:EXT-2': { id: 'msg-2' } },
    });
    findByExternalId.mockRejectedValueOnce(new Error('conexão perdida'));

    await expect(useCase.execute()).resolves.toBeUndefined();

    expect(uploads.finishConsume).toHaveBeenCalledWith('up-2', 'msg-2');
    expect(uploads.releaseConsume).toHaveBeenCalledWith('up-3');
    // Sem saber se a mensagem existe, o upload não é descartado
    expect(uploads.discard).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ uploadId: 'up-1' }),
      expect.any(String),
    );
  });

  it('falha ao listar os uploads só vai para o log e não derruba o boot', async () => {
    const { useCase, uploads } = makeUseCase({ consumindo: [], falhaLista: true });

    await expect(useCase.execute()).resolves.toBeUndefined();

    expect(uploads.finishConsume).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
