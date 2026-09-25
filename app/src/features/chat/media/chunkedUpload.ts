import type { mediaService } from '@/services/media.service';
import type { MediaUploadPurpose } from '@/types/media.api.types';

// Espera exponencial entre tentativas (1 s, 2 s, 4 s … teto 30 s). A janela de ~3 min cobre um
// deploy com disco, que não tem zero-downtime, e recomeça a cada operação concluída.
const FIRST_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const RETRY_WINDOW_MS = 180_000;

/** Mesma forma do `mediaService`; injetado para teste. */
export type ChunkedUploadClient = Pick<
  typeof mediaService,
  'createUpload' | 'putPart' | 'getUpload' | 'cancelUpload'
>;

/** Sessão de upload: o que o chamador guarda para retomar depois de uma falha. */
export interface UploadSessionRef {
  uploadId: string;
  chunkSizeBytes: number;
}

interface BaseInput {
  file: Blob;
  fileName: string;
  purpose: MediaUploadPurpose;
  declaredMimeType?: string;
  client: ChunkedUploadClient;
  signal?: AbortSignal;
  /** 0–100, só sobe. */
  onProgress?: (percent: number) => void;
  /** Chamado assim que a sessão nova existe — antes da primeira parte. */
  onUploadCreated?: (session: UploadSessionRef) => void;
  /** Espera entre tentativas; deve acordar cedo quando o `signal` abortar. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

/** Retomada exige o tamanho de parte da sessão original: o `GET` do upload não o devolve. */
type ResumeInput =
  | { existingUploadId?: undefined; chunkSizeBytes?: undefined }
  | { existingUploadId: string; chunkSizeBytes: number };

export type UploadInPartsInput = BaseInput & ResumeInput;

/** Upload cancelado pelo `signal`: o upload já foi apagado no servidor. */
export class UploadAbortedError extends Error {
  override name = 'AbortError';

  constructor() {
    super('Upload cancelado');
  }
}

const statusOf = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
};

/** Sessão expirada, descartada ou de outro dono: o chamador sobe o arquivo de novo. */
export const isUploadGone = (error: unknown): boolean => statusOf(error) === 404;

/** Rede (sem `status`), 5xx e 429 passam; 4xx não — inclusive o 413 genérico (`HTTP_ERROR`). */
function isTransient(error: unknown): boolean {
  const status = statusOf(error);
  return status === undefined || status >= 500 || status === 429;
}

function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * Envia o arquivo em partes, em sequência. Com `existingUploadId`, retoma: pula as partes que o
 * servidor já tem. Rejeita com `UploadAbortedError` no cancelamento, com erro de status 404
 * (`isUploadGone`) se a sessão sumiu e, nos demais casos, com o último erro da API.
 */
export async function uploadInParts(input: UploadInPartsInput): Promise<{ uploadId: string }> {
  const { file, client, signal, onProgress, sleep = waitFor, now = Date.now } = input;
  let uploadId = input.existingUploadId;

  const throwIfAborted = () => {
    if (signal?.aborted) throw new UploadAbortedError();
  };

  /** Repete a operação em falha temporária; `attempt` = falhas anteriores. */
  const retrying = async <T>(operation: (attempt: number) => Promise<T>): Promise<T> => {
    let firstFailureAt: number | undefined;
    for (let attempt = 0; ; attempt++) {
      throwIfAborted();
      try {
        return await operation(attempt);
      } catch (error) {
        if (signal?.aborted || !isTransient(error)) throw error;
        firstFailureAt ??= now();
        if (now() - firstFailureAt >= RETRY_WINDOW_MS) throw error;
        await sleep(Math.min(FIRST_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS), signal);
      }
    }
  };

  try {
    throwIfAborted();
    const received = new Set<number>();
    const markReceived = (parts: number[]) => parts.forEach((i) => received.add(i));
    let chunk: number;
    if (input.existingUploadId === undefined) {
      const created = await client.createUpload({
        fileName: input.fileName,
        sizeBytes: file.size,
        purpose: input.purpose,
        declaredMimeType: input.declaredMimeType,
      });
      uploadId = created.uploadId;
      chunk = created.chunkSizeBytes;
      throwIfAborted();
      input.onUploadCreated?.({ uploadId, chunkSizeBytes: chunk });
    } else {
      const resumeId = input.existingUploadId;
      uploadId = resumeId;
      chunk = input.chunkSizeBytes;
      markReceived((await retrying(() => client.getUpload(resumeId))).receivedParts);
    }
    const id = uploadId;
    const totalParts = Math.ceil(file.size / chunk);
    const partBytes = (i: number) => Math.min(chunk, file.size - i * chunk);

    // Progresso = partes confirmadas + bytes em voo da atual; nunca emite valor menor.
    let lastPercent = -1;
    const report = (inFlightBytes: number) => {
      let bytes = inFlightBytes;
      received.forEach((i) => {
        if (i < totalParts) bytes += partBytes(i);
      });
      const percent = Math.min(100, Math.floor((bytes * 100) / file.size));
      if (percent > lastPercent) {
        lastPercent = percent;
        onProgress?.(percent);
      }
    };
    report(0);

    for (let index = 0; index < totalParts; index++) {
      if (received.has(index)) continue;
      const blob = file.slice(index * chunk, index * chunk + partBytes(index));
      await retrying(async (attempt) => {
        // A parte pode ter chegado mesmo com erro na resposta: reconsulta antes de reenviar.
        if (attempt > 0) {
          markReceived((await client.getUpload(id)).receivedParts);
          if (received.has(index)) return;
          throwIfAborted();
        }
        const result = await client.putPart(id, index, blob, {
          signal,
          onProgress: (sent) => report(Math.min(sent, blob.size)),
        });
        markReceived([...result.receivedParts, index]);
      });
      report(0);
    }

    throwIfAborted();
    return { uploadId: id };
  } catch (error) {
    if (!signal?.aborted) throw error;
    // Melhor esforço: o servidor apaga por TTL se o DELETE não chegar.
    if (uploadId !== undefined) client.cancelUpload(uploadId).catch(() => undefined);
    throw new UploadAbortedError();
  }
}
