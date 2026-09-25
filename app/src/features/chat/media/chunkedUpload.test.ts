import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PutPartOptions } from '@/services/media.service';
import type { CreateUploadRequest } from '@/types/media.api.types';
import {
  isUploadGone,
  uploadInParts,
  UploadAbortedError,
  type ChunkedUploadClient,
  type UploadInPartsInput,
} from './chunkedUpload';

const CHUNK = 10;

/** Erro no formato do `apiClient`: sem `status` = rede. */
const httpError = (status?: number, code?: string) =>
  Object.assign(new Error('falha'), { status, code });

/** Servidor falso: guarda as partes recebidas e responde como a API. */
function fakeServer(initialParts: number[] = []) {
  const parts = new Set(initialParts);
  let total = 0;
  const receivedParts = () => [...parts].sort((a, b) => a - b);
  const client = {
    createUpload: vi.fn(async (req: CreateUploadRequest) => {
      total = Math.ceil(req.sizeBytes / CHUNK);
      return {
        uploadId: 'up-1',
        chunkSizeBytes: CHUNK,
        totalParts: total,
        receivedParts: [],
        expiresAt: '2026-09-25T12:00:00.000Z',
      };
    }),
    // Metade e depois o pedaço inteiro, como o `onUploadProgress` do axios.
    putPart: vi.fn(async (_id: string, index: number, blob: Blob, opts: PutPartOptions = {}) => {
      opts.onProgress?.(blob.size / 2);
      opts.onProgress?.(blob.size);
      parts.add(index);
      return { receivedParts: receivedParts(), complete: parts.size === total };
    }),
    getUpload: vi.fn(async (_id: string) => ({
      receivedParts: receivedParts(),
      complete: false,
      state: 'OPEN' as const,
      messageId: null,
    })),
    cancelUpload: vi.fn(async (_id: string) => undefined),
  } satisfies ChunkedUploadClient;
  return { client, parts };
}

/** Relógio controlado: cada espera avança o tempo na hora, sem esperar de verdade. */
function fakeClock() {
  let t = 0;
  const sleep = vi.fn(async (ms: number) => {
    t += ms;
  });
  return { now: () => t, sleep, waits: () => sleep.mock.calls.map(([ms]) => ms) };
}

const fileOf = (size: number) => new Blob([new Uint8Array(size)]);

function setup(size = 25, initialParts: number[] = []) {
  const server = fakeServer(initialParts);
  const clock = fakeClock();
  const progress: number[] = [];
  const file = fileOf(size);
  const input: UploadInPartsInput = {
    file,
    fileName: 'foto.jpg',
    purpose: 'media',
    declaredMimeType: 'image/jpeg',
    client: server.client,
    onProgress: (p) => progress.push(p),
    sleep: clock.sleep,
    now: clock.now,
  };
  const sentIndexes = () => server.client.putPart.mock.calls.map(([, index]) => index);
  return { ...server, clock, progress, file, input, sentIndexes };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('upload em partes: envio', () => {
  it('cria a sessão e envia as partes em sequência, cada uma com o pedaço certo do arquivo', async () => {
    const { client, file, input, sentIndexes } = setup(25);
    const slice = vi.spyOn(file, 'slice');

    await expect(uploadInParts(input)).resolves.toEqual({ uploadId: 'up-1' });

    expect(client.createUpload).toHaveBeenCalledWith({
      fileName: 'foto.jpg',
      sizeBytes: 25,
      purpose: 'media',
      declaredMimeType: 'image/jpeg',
    });
    expect(sentIndexes()).toEqual([0, 1, 2]);
    expect(slice.mock.calls).toEqual([
      [0, 10],
      [10, 20],
      [20, 25],
    ]);
    expect(client.putPart.mock.calls.map(([, , blob]) => blob.size)).toEqual([10, 10, 5]);
  });

  it('progresso vai de 0 a 100 somando partes concluídas e bytes em voo', async () => {
    const { input, progress } = setup(25);

    await uploadInParts(input);

    expect(progress).toEqual([0, 20, 40, 60, 80, 90, 100]);
  });

  it('avisa o uploadId e o tamanho da parte assim que a sessão existe, antes da primeira parte', async () => {
    const { client, input } = setup(25);
    const onUploadCreated = vi.fn(() => {
      expect(client.putPart).not.toHaveBeenCalled();
    });

    await uploadInParts({ ...input, onUploadCreated });

    expect(onUploadCreated).toHaveBeenCalledExactlyOnceWith({ uploadId: 'up-1', chunkSizeBytes: CHUNK });
  });
});

describe('upload em partes: retomada', () => {
  it('consulta o upload existente e envia só as partes que o servidor ainda não tem', async () => {
    const { client, input, progress, sentIndexes } = setup(25, [0, 2]);

    await expect(
      uploadInParts({ ...input, existingUploadId: 'up-9', chunkSizeBytes: CHUNK }),
    ).resolves.toEqual({ uploadId: 'up-9' });

    expect(client.createUpload).not.toHaveBeenCalled();
    expect(client.getUpload).toHaveBeenCalledWith('up-9');
    expect(sentIndexes()).toEqual([1]);
    expect(client.putPart.mock.calls[0]?.[0]).toBe('up-9');
    expect(progress).toEqual([60, 80, 100]);
  });

  it('sessão que sumiu (404) vira erro identificável, sem nova tentativa', async () => {
    const { client, clock, input } = setup(25);
    client.getUpload.mockRejectedValueOnce(httpError(404, 'UPLOAD_NOT_FOUND'));

    const error = await uploadInParts({ ...input, existingUploadId: 'up-9', chunkSizeBytes: CHUNK }).catch(
      (e: unknown) => e,
    );

    expect(isUploadGone(error)).toBe(true);
    expect(client.putPart).not.toHaveBeenCalled();
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it('só 404 conta como sessão sumida', () => {
    expect(isUploadGone(httpError(404))).toBe(true);
    expect(isUploadGone(httpError(410))).toBe(false);
    expect(isUploadGone(httpError())).toBe(false);
    expect(isUploadGone(new UploadAbortedError())).toBe(false);
  });
});

describe('upload em partes: falhas', () => {
  it('queda de rede espera 1 s, reconsulta o upload e reenvia a parte', async () => {
    const { client, clock, input, sentIndexes } = setup(25);
    client.putPart.mockRejectedValueOnce(httpError());

    await expect(uploadInParts(input)).resolves.toEqual({ uploadId: 'up-1' });

    expect(clock.waits()).toEqual([1000]);
    expect(client.getUpload).toHaveBeenCalledOnce();
    expect(sentIndexes()).toEqual([0, 0, 1, 2]);
  });

  it.each([500, 503, 429])('status %i também é temporário e tenta de novo', async (status) => {
    const { client, clock, input } = setup(25);
    client.putPart.mockRejectedValueOnce(httpError(status));

    await expect(uploadInParts(input)).resolves.toEqual({ uploadId: 'up-1' });

    expect(clock.waits()).toEqual([1000]);
  });

  it('não reenvia a parte que chegou ao servidor apesar do erro na resposta', async () => {
    const { client, input, parts, sentIndexes } = setup(25);
    client.putPart.mockImplementationOnce(async (_id, index) => {
      parts.add(index);
      throw httpError();
    });

    await uploadInParts(input);

    expect(sentIndexes()).toEqual([0, 1, 2]);
  });

  it('erro do servidor contínuo esgota a janela de ~3 min com espera exponencial e rejeita com o último erro', async () => {
    const { client, clock, input } = setup(25);
    const last = httpError(503, 'SERVICE_UNAVAILABLE');
    client.putPart.mockRejectedValue(last);

    await expect(uploadInParts(input)).rejects.toBe(last);

    expect(clock.waits()).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000]);
    expect(client.putPart).toHaveBeenCalledTimes(11);
    expect(client.getUpload).toHaveBeenCalledTimes(10);
    expect(client.cancelUpload).not.toHaveBeenCalled();
  });

  it('a janela recomeça a cada parte concluída', async () => {
    const { client, clock, input } = setup(25);
    client.putPart
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(httpError(503))
      .mockImplementationOnce(async () => {
        clock.sleep.mockClear();
        return { receivedParts: [0], complete: false };
      })
      .mockRejectedValueOnce(httpError(503));

    await uploadInParts(input);

    expect(clock.waits()).toEqual([1000]);
  });

  it('erro 4xx falha na hora, sem nova tentativa', async () => {
    const { client, clock, input } = setup(25);
    const rejected = httpError(400, 'VALIDATION_ERROR');
    client.putPart.mockRejectedValueOnce(rejected);

    await expect(uploadInParts(input)).rejects.toBe(rejected);

    expect(client.putPart).toHaveBeenCalledOnce();
    expect(client.getUpload).not.toHaveBeenCalled();
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it('413 genérico do servidor (HTTP_ERROR) falha na hora: decide pelo status, não pelo código', async () => {
    const { client, clock, input } = setup(25);
    const tooLarge = httpError(413, 'HTTP_ERROR');
    client.putPart.mockRejectedValueOnce(tooLarge);

    await expect(uploadInParts(input)).rejects.toBe(tooLarge);

    expect(client.putPart).toHaveBeenCalledOnce();
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it('progresso não regride quando a parte é reenviada', async () => {
    const { client, input, progress } = setup(25);
    client.putPart.mockImplementationOnce(async (_id, _index, _blob, opts = {}) => {
      opts.onProgress?.(8);
      throw httpError();
    });

    await uploadInParts(input);

    expect(progress).toEqual([0, 32, 40, 60, 80, 90, 100]);
    progress.slice(1).forEach((p, i) => expect(p).toBeGreaterThan(progress[i] ?? -1));
  });
});

describe('upload em partes: cancelamento', () => {
  it('cancelar no meio de uma parte para, apaga o upload e não tenta de novo', async () => {
    const { client, clock, input, sentIndexes } = setup(25);
    const controller = new AbortController();
    // Como o axios: o `signal` abortado rejeita a chamada sem `status`.
    client.putPart.mockImplementationOnce(async (_id, index) => ({ receivedParts: [index], complete: false }));
    client.putPart.mockImplementationOnce(async () => {
      controller.abort();
      throw httpError();
    });

    const error = await uploadInParts({ ...input, signal: controller.signal }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UploadAbortedError);
    expect((error as Error).name).toBe('AbortError');
    expect(client.cancelUpload).toHaveBeenCalledExactlyOnceWith('up-1');
    expect(sentIndexes()).toEqual([0, 1]);
    expect(clock.sleep).not.toHaveBeenCalled();
    expect(client.getUpload).not.toHaveBeenCalled();
  });

  it('cancelar durante a espera entre tentativas não tenta de novo', async () => {
    const { client, clock, input } = setup(25);
    const controller = new AbortController();
    client.putPart.mockRejectedValueOnce(httpError());
    clock.sleep.mockImplementationOnce(async () => controller.abort());

    await expect(uploadInParts({ ...input, signal: controller.signal })).rejects.toBeInstanceOf(
      UploadAbortedError,
    );

    expect(client.putPart).toHaveBeenCalledOnce();
    expect(client.getUpload).not.toHaveBeenCalled();
    expect(client.cancelUpload).toHaveBeenCalledExactlyOnceWith('up-1');
  });

  it('já cancelado antes de começar não cria sessão nem envia nada', async () => {
    const { client, input } = setup(25);
    const controller = new AbortController();
    controller.abort();

    await expect(uploadInParts({ ...input, signal: controller.signal })).rejects.toBeInstanceOf(
      UploadAbortedError,
    );

    expect(client.createUpload).not.toHaveBeenCalled();
    expect(client.putPart).not.toHaveBeenCalled();
    expect(client.cancelUpload).not.toHaveBeenCalled();
  });

  it('cancelar enquanto a sessão é criada apaga a sessão recém-criada', async () => {
    const { client, input } = setup(25);
    const controller = new AbortController();
    client.createUpload.mockImplementationOnce(async (req) => {
      controller.abort();
      return { uploadId: 'up-2', chunkSizeBytes: CHUNK, totalParts: Math.ceil(req.sizeBytes / CHUNK), receivedParts: [], expiresAt: '' };
    });

    await expect(uploadInParts({ ...input, signal: controller.signal })).rejects.toBeInstanceOf(
      UploadAbortedError,
    );

    expect(client.putPart).not.toHaveBeenCalled();
    expect(client.cancelUpload).toHaveBeenCalledExactlyOnceWith('up-2');
  });

  it('falha ao apagar o upload cancelado é ignorada', async () => {
    const { client, input } = setup(25);
    const controller = new AbortController();
    client.cancelUpload.mockRejectedValueOnce(httpError());
    client.putPart.mockImplementationOnce(async () => {
      controller.abort();
      throw httpError();
    });

    await expect(uploadInParts({ ...input, signal: controller.signal })).rejects.toBeInstanceOf(
      UploadAbortedError,
    );
    expect(client.cancelUpload).toHaveBeenCalledOnce();
  });
});

describe('upload em partes: espera padrão (timers falsos)', () => {
  it('sem espera injetada, aguarda 1 s de relógio antes de reenviar', async () => {
    vi.useFakeTimers();
    const { client, input } = setup(25);
    client.putPart.mockRejectedValueOnce(httpError());

    const done = uploadInParts({ ...input, sleep: undefined, now: undefined });
    await vi.advanceTimersByTimeAsync(999);
    expect(client.putPart).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    await expect(done).resolves.toEqual({ uploadId: 'up-1' });
    expect(client.putPart).toHaveBeenCalledTimes(4);
  });

  it('cancelar acorda a espera na hora, sem aguardar o tempo todo', async () => {
    vi.useFakeTimers();
    const { client, input } = setup(25);
    const controller = new AbortController();
    client.putPart.mockRejectedValueOnce(httpError());

    const done = uploadInParts({ ...input, signal: controller.signal, sleep: undefined, now: undefined });
    const outcome = done.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();

    expect(await outcome).toBeInstanceOf(UploadAbortedError);
    expect(vi.getTimerCount()).toBe(0);
    expect(client.putPart).toHaveBeenCalledOnce();
  });
});
