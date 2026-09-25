import { describe, it, expect, vi } from 'vitest';
import { CancelUploadSessionUseCase } from './CancelUploadSessionUseCase';
import { UploadInProgressError } from '../../../../shared/errors/internal/MediaErrors';
import type {
  IUploadSessionStore,
  UploadSessionRecord,
  UploadSessionState,
} from '../../domain/contracts/IUploadSessionStore';

const TENANT = 'tenant-1';
const USER = 'user-1';
const UPLOAD = '0b6f1c1e-5d2a-4c3b-9f4e-2a1d3c4b5e6f';

function makeRecord(state: UploadSessionState): UploadSessionRecord {
  return {
    uploadId: UPLOAD, tenantId: TENANT, userId: USER, purpose: 'voice',
    fileName: 'audio.webm', declaredMimeType: 'audio/webm',
    sizeBytes: 250, chunkSizeBytes: 100, totalParts: 3,
    receivedParts: [0], state,
    externalMessageId: state === 'OPEN' ? null : 'ext-1',
    messageId: state === 'CONSUMED' ? 'msg-1' : null,
    createdAt: '2026-09-25T12:00:00.000Z', updatedAt: '2026-09-25T12:00:00.000Z',
  };
}

/** Store falso: `discardIfOpen`/`requestCancel` respondem pelo estado lido, salvo quando o teste troca. */
function makeDeps(record: UploadSessionRecord | null) {
  const store = {
    get: vi.fn().mockResolvedValue(record),
    discardIfOpen: vi.fn().mockResolvedValue(record?.state === 'OPEN'),
    requestCancel: vi.fn().mockResolvedValue(record?.state === 'CONSUMING'),
  } as unknown as IUploadSessionStore;
  return { useCase: new CancelUploadSessionUseCase(store), store };
}

const run = (d: ReturnType<typeof makeDeps>) =>
  d.useCase.execute({ tenantId: TENANT, userId: USER, uploadId: UPLOAD });

describe('CancelUploadSessionUseCase', () => {
  it('upload aberto: descarta o parcial', async () => {
    const d = makeDeps(makeRecord('OPEN'));

    await expect(run(d)).resolves.toBeUndefined();
    expect(d.store.get).toHaveBeenCalledWith(UPLOAD, TENANT, USER);
    expect(d.store.discardIfOpen).toHaveBeenCalledWith(UPLOAD);
    expect(d.store.requestCancel).not.toHaveBeenCalled();
  });

  it('upload inexistente ou de outro dono: sucesso silencioso, sem descartar nada', async () => {
    const d = makeDeps(null);

    await expect(run(d)).resolves.toBeUndefined();
    expect(d.store.discardIfOpen).not.toHaveBeenCalled();
  });

  it('cancelar duas vezes: a segunda também responde sucesso', async () => {
    const d = makeDeps(makeRecord('OPEN'));
    vi.mocked(d.store.get).mockResolvedValueOnce(makeRecord('OPEN')).mockResolvedValueOnce(null);

    await run(d);
    await expect(run(d)).resolves.toBeUndefined();
    expect(d.store.discardIfOpen).toHaveBeenCalledTimes(1);
  });

  it('upload virando mensagem: pede o cancelamento e avisa com 409 que ele pode já ter saído', async () => {
    const d = makeDeps(makeRecord('CONSUMING'));

    await expect(run(d)).rejects.toBeInstanceOf(UploadInProgressError);
    expect(d.store.requestCancel).toHaveBeenCalledWith(UPLOAD);
  });

  it('confirmação que começa entre a leitura e o descarte: pede o cancelamento em vez de apagar', async () => {
    const d = makeDeps(makeRecord('OPEN'));
    vi.mocked(d.store.discardIfOpen).mockResolvedValue(false);
    vi.mocked(d.store.requestCancel).mockResolvedValue(true);

    await expect(run(d)).rejects.toBeInstanceOf(UploadInProgressError);
    expect(d.store.requestCancel).toHaveBeenCalledWith(UPLOAD);
  });

  it('consumo que falha e reabre o upload antes do pedido: descarta o que voltou a aberto', async () => {
    const d = makeDeps(makeRecord('CONSUMING'));
    vi.mocked(d.store.requestCancel).mockResolvedValue(false);
    vi.mocked(d.store.discardIfOpen).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(run(d)).resolves.toBeUndefined();
    expect(d.store.discardIfOpen).toHaveBeenCalledTimes(2);
  });

  it('consumo que termina antes do pedido: sucesso, sem 409', async () => {
    const d = makeDeps(makeRecord('CONSUMING'));
    vi.mocked(d.store.requestCancel).mockResolvedValue(false);

    await expect(run(d)).resolves.toBeUndefined();
    expect(d.store.requestCancel).toHaveBeenCalledWith(UPLOAD);
  });

  it('upload já consumido: preserva mensagem, arquivo promovido e lateral', async () => {
    const d = makeDeps(makeRecord('CONSUMED'));

    await expect(run(d)).resolves.toBeUndefined();
    expect(d.store.discardIfOpen).not.toHaveBeenCalled();
    expect(d.store.requestCancel).not.toHaveBeenCalled();
  });
});
