import { AppError } from '../AppError';

// ── Media / upload errors ─────────────────────────────────────────────────────
//
// `meta` e `message` vão para o cliente (errorHandler). Nunca passar caminho de
// disco: use ids, bytes, tipos MIME e códigos. `meta` é plano (sem objetos
// aninhados) e passa por `withoutDiskPaths`, que descarta chaves de caminho
// (`*path`, `*dir`) e valores com cara de caminho absoluto.

export type MediaErrorMeta = Readonly<Record<string, string | number | boolean | null | undefined>>;

const PATH_KEY = /(path|dir)$/i;
const PATH_VALUE = /^(\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/])|\\/;

function withoutDiskPaths(meta?: MediaErrorMeta): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const safe = Object.entries(meta).filter(
    ([key, value]) => !PATH_KEY.test(key) && !(typeof value === 'string' && PATH_VALUE.test(value)),
  );
  return safe.length ? Object.fromEntries(safe) : undefined;
}

export class MediaTooLargeError extends AppError {
  constructor(message = 'Media exceeds the allowed size', meta?: MediaErrorMeta) {
    super('MEDIA_TOO_LARGE', message, 413, withoutDiskPaths(meta));
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'Media type is not supported', meta?: MediaErrorMeta) {
    super('UNSUPPORTED_MEDIA_TYPE', message, 415, withoutDiskPaths(meta));
  }
}

export class MediaProcessingFailedError extends AppError {
  constructor(message = 'Media processing failed', meta?: MediaErrorMeta) {
    super('MEDIA_PROCESSING_FAILED', message, 422, withoutDiskPaths(meta));
  }
}

export class MediaProcessorUnavailableError extends AppError {
  constructor(message = 'Media processor is unavailable', meta?: MediaErrorMeta) {
    super('MEDIA_PROCESSOR_UNAVAILABLE', message, 503, withoutDiskPaths(meta));
  }
}

export class UploadNotFoundError extends AppError {
  constructor(message = 'Upload not found', meta?: MediaErrorMeta) {
    super('UPLOAD_NOT_FOUND', message, 404, withoutDiskPaths(meta));
  }
}

export class UploadIncompleteError extends AppError {
  constructor(message = 'Upload is incomplete', meta?: MediaErrorMeta) {
    super('UPLOAD_INCOMPLETE', message, 409, withoutDiskPaths(meta));
  }
}

export class UploadInProgressError extends AppError {
  constructor(message = 'Upload is already being confirmed', meta?: MediaErrorMeta) {
    super('UPLOAD_IN_PROGRESS', message, 409, withoutDiskPaths(meta));
  }
}

export class InsufficientStorageError extends AppError {
  constructor(message = 'Insufficient storage for this upload', meta?: MediaErrorMeta) {
    super('INSUFFICIENT_STORAGE', message, 507, withoutDiskPaths(meta));
  }
}
