import { describe, it, expect, vi } from 'vitest';
import { AppendUploadPartUseCase } from './AppendUploadPartUseCase';
import { UploadNotFoundError } from '../../../../shared/errors/internal/MediaErrors';
import { ConflictError, ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import type {
  IUploadSessionStore,
  UploadSessionRecord,
  WriteUploadPartResult,
} from '../../domain/contracts/IUploadSessionStore';

const TENANT = 'tenant-1';
const USER = 'user-1';
const UPLOAD = '0b6f1c1e-5d2a-4c3b-9f4e-2a1d3c4b5e6f';

/** 250 bytes em partes de 100: a última (índice 2) leva 50. */
function makeRecord(overrides?: Partial<UploadSessionRecord>): UploadSessionRecord {
  return {
    uploadId: UPLOAD, tenantId: TENANT, userId: USER, purpose: 'media',
    fileName: 'foto.jpg', declaredMimeType: 'image/jpeg',
    sizeBytes: 250, chunkSizeBytes: 100, totalParts: 3,
    receivedParts: [], state: 'OPEN', externalMessageId: null, messageId: null,
    createdAt: '2026-09-25T12:00:00.000Z', updatedAt: '2026-09-25T12:00:00.000Z',
    ...overrides,
  };
}

function makeDeps(overrides?: { record?: UploadSessionRecord | null; write?: WriteUploadPartResult }) {
  const record = overrides?.record === undefined ? makeRecord() : overrides.record;
  const store = {
    get: vi.fn().mockResolvedValue(record),
    writePart: vi.fn().mockResolvedValue(
      overrides?.write ?? { status: 'written', record: makeRecord({ receivedParts: [0] }) },
    ),
  } as unknown as IUploadSessionStore;
  return { useCase: new AppendUploadPartUseCase(store), store };
}

const run = (d: ReturnType<typeof makeDeps>, index = 0, length = 100) =>
  d.useCase.execute({ tenantId: TENANT, userId: USER, uploadId: UPLOAD, index, data: new Uint8Array(length) });

describe('AppendUploadPartUseCase', () => {
  it('parte válida em upload aberto: grava e devolve as partes recebidas, ainda incompleto', async () => {
    const d = makeDeps();
    const out = await run(d);

    expect(d.store.get).toHaveBeenCalledWith(UPLOAD, TENANT, USER);
    expect(d.store.writePart).toHaveBeenCalledWith(UPLOAD, 0, expect.any(Uint8Array));
    expect(out).toEqual({ receivedParts: [0], complete: false });
  });

  it('última parte com o resto do arquivo completa o upload', async () => {
    const d = makeDeps({
      record: makeRecord({ receivedParts: [0, 1] }),
      write: { status: 'written', record: makeRecord({ receivedParts: [0, 1, 2] }) },
    });

    await expect(run(d, 2, 50)).resolves.toEqual({ receivedParts: [0, 1, 2], complete: true });
  });

  it('upload inexistente ou de outro dono: UPLOAD_NOT_FOUND sem escrever', async () => {
    const d = makeDeps({ record: null });

    const err = await run(d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadNotFoundError);
    expect(err).toMatchObject({ code: 'UPLOAD_NOT_FOUND', statusCode: 404 });
    expect(d.store.writePart).not.toHaveBeenCalled();
  });

  it('índice fora do plano: VALIDATION_ERROR com o motivo, sem escrever', async () => {
    const d = makeDeps();

    const err = await run(d, 3, 100).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({ statusCode: 400, meta: { index: 3, reason: 'invalid_index' } });
    expect(d.store.writePart).not.toHaveBeenCalled();
  });

  it('última parte enviada com chunk cheio: VALIDATION_ERROR por tamanho, sem escrever', async () => {
    const d = makeDeps();

    const err = await run(d, 2, 100).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({ meta: { index: 2, reason: 'invalid_length' } });
    expect(d.store.writePart).not.toHaveBeenCalled();
  });

  it.each(['CONSUMING', 'CONSUMED'] as const)('upload em %s recusa a parte com 409, sem escrever', async (state) => {
    const d = makeDeps({ record: makeRecord({ state }) });

    const err = await run(d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toMatchObject({ statusCode: 409 });
    expect(d.store.writePart).not.toHaveBeenCalled();
  });

  it('consumo começou entre a consulta e a escrita: 409', async () => {
    const d = makeDeps({ write: { status: 'not_open', record: makeRecord({ state: 'CONSUMING' }) } });

    await expect(run(d)).rejects.toBeInstanceOf(ConflictError);
  });

  it('upload descartado entre a consulta e a escrita: UPLOAD_NOT_FOUND', async () => {
    const d = makeDeps({ write: { status: 'not_found' } });

    await expect(run(d)).rejects.toBeInstanceOf(UploadNotFoundError);
  });
});
