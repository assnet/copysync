import { describe, it, expect, vi } from 'vitest';
import { GetUploadSessionUseCase } from './GetUploadSessionUseCase';
import { UploadNotFoundError } from '../../../../shared/errors/internal/MediaErrors';
import type { IUploadSessionStore, UploadSessionRecord } from '../../domain/contracts/IUploadSessionStore';

const TENANT = 'tenant-1';
const USER = 'user-1';
const UPLOAD = '0b6f1c1e-5d2a-4c3b-9f4e-2a1d3c4b5e6f';

function makeRecord(overrides?: Partial<UploadSessionRecord>): UploadSessionRecord {
  return {
    uploadId: UPLOAD, tenantId: TENANT, userId: USER, purpose: 'document',
    fileName: 'contrato.pdf', declaredMimeType: 'application/pdf',
    sizeBytes: 250, chunkSizeBytes: 100, totalParts: 3,
    receivedParts: [0, 2], state: 'OPEN', externalMessageId: null, messageId: null,
    createdAt: '2026-09-25T12:00:00.000Z', updatedAt: '2026-09-25T12:00:00.000Z',
    ...overrides,
  };
}

function makeDeps(record: UploadSessionRecord | null = makeRecord()) {
  const store = { get: vi.fn().mockResolvedValue(record) } as unknown as IUploadSessionStore;
  return { useCase: new GetUploadSessionUseCase(store), store };
}

const run = (d: ReturnType<typeof makeDeps>) =>
  d.useCase.execute({ tenantId: TENANT, userId: USER, uploadId: UPLOAD });

describe('GetUploadSessionUseCase', () => {
  it('upload aberto e parcial: devolve as partes recebidas para retomar o envio', async () => {
    const d = makeDeps();

    await expect(run(d)).resolves.toEqual({
      receivedParts: [0, 2], complete: false, state: 'OPEN', messageId: null,
    });
    expect(d.store.get).toHaveBeenCalledWith(UPLOAD, TENANT, USER);
  });

  it('upload já consumido: devolve completo com a mensagem gerada', async () => {
    const d = makeDeps(makeRecord({ receivedParts: [0, 1, 2], state: 'CONSUMED', messageId: 'msg-1' }));

    await expect(run(d)).resolves.toEqual({
      receivedParts: [0, 1, 2], complete: true, state: 'CONSUMED', messageId: 'msg-1',
    });
  });

  it('upload inexistente, expirado ou de outro dono: UPLOAD_NOT_FOUND', async () => {
    const d = makeDeps(null);

    const err = await run(d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadNotFoundError);
    expect(err).toMatchObject({ code: 'UPLOAD_NOT_FOUND', statusCode: 404 });
  });
});
