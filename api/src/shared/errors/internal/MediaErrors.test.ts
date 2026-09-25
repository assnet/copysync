import { describe, it, expect } from 'vitest';
import { AppError } from '../AppError';
import {
  MediaTooLargeError,
  UnsupportedMediaTypeError,
  MediaProcessingFailedError,
  MediaProcessorUnavailableError,
  UploadNotFoundError,
  UploadIncompleteError,
  UploadInProgressError,
  InsufficientStorageError,
} from './MediaErrors';

describe('MediaErrors', () => {
  it.each([
    [new MediaTooLargeError(), 'MEDIA_TOO_LARGE', 413],
    [new UnsupportedMediaTypeError(), 'UNSUPPORTED_MEDIA_TYPE', 415],
    [new MediaProcessingFailedError(), 'MEDIA_PROCESSING_FAILED', 422],
    [new MediaProcessorUnavailableError(), 'MEDIA_PROCESSOR_UNAVAILABLE', 503],
    [new UploadNotFoundError(), 'UPLOAD_NOT_FOUND', 404],
    [new UploadIncompleteError(), 'UPLOAD_INCOMPLETE', 409],
    [new UploadInProgressError(), 'UPLOAD_IN_PROGRESS', 409],
    [new InsufficientStorageError(), 'INSUFFICIENT_STORAGE', 507],
  ])('%s responde com o código e o HTTP do contrato', (error, code, status) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(code);
    expect(error.statusCode).toBe(status);
  });

  it('meta nunca leva caminho de disco ao cliente', () => {
    const error = new MediaTooLargeError('grande', {
      limitBytes: 16_000_000,
      mimeType: 'audio/ogg; codecs=opus',
      tmpPath: 'qualquer',
      uploadDir: 'qualquer',
      file: '/var/data/media-uploads/x.bin',
      relativo: '../x',
      windows: 'C:\\dados\\x',
    });
    expect(error.meta).toEqual({ limitBytes: 16_000_000, mimeType: 'audio/ogg; codecs=opus' });
  });

  it('meta só com caminhos vira ausente', () => {
    expect(new UploadNotFoundError('x', { path: '/tmp/a' }).meta).toBeUndefined();
  });
});
