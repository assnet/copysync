import { AppError } from '../AppError';

// ── Secret cipher errors ─────────────────────────────────────────────────────

/** Chave de cifra ausente ou malformada: nada é gravado em claro. */
export class SecretCipherUnavailableError extends AppError {
  constructor() {
    super('SECRET_CIPHER_UNAVAILABLE', 'Secret encryption is not configured', 503);
  }
}

/** Blob adulterado, chave errada ou AAD de outro contexto. */
export class SecretCipherFailedError extends AppError {
  constructor() {
    super('SECRET_CIPHER_FAILED', 'Secret decryption failed', 500);
  }
}
