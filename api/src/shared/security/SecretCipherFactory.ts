import { env } from '../config/env';
import type { ISecretCipher } from './ISecretCipher';
import { AesGcmSecretCipher } from './AesGcmSecretCipher';
import { SecretCipherUnavailableError } from '../errors/internal/SecretCipherErrors';

const KEY_BYTES = 32;
const CURRENT_KEY_VERSION = 1;

/** Motivo de a chave não servir, ou null se serve. Nunca inclui o valor. */
export function describeKeyProblem(raw: string | undefined): string | null {
  if (!raw) return 'missing';
  const decoded = Buffer.from(raw.trim(), 'base64');
  if (decoded.length !== KEY_BYTES) return `expected ${KEY_BYTES} bytes after base64, got ${decoded.length}`;
  return null;
}

let cached: ISecretCipher | null = null;

/**
 * Cria a cifra no primeiro uso a partir de `CREDENTIALS_ENCRYPTION_KEY`. Chave ausente ou com
 * tamanho errado = indisponível (503) só para quem cifra; o boot nunca cai por isso.
 */
export const SecretCipherFactory = {
  /** Para o boot logar o problema. null = chave válida. */
  check(): string | null {
    return describeKeyProblem(env.CREDENTIALS_ENCRYPTION_KEY);
  },

  get(): ISecretCipher {
    if (cached) return cached;
    const raw = env.CREDENTIALS_ENCRYPTION_KEY;
    if (describeKeyProblem(raw)) throw new SecretCipherUnavailableError();
    cached = new AesGcmSecretCipher(
      new Map([[CURRENT_KEY_VERSION, Buffer.from(raw!.trim(), 'base64')]]),
      CURRENT_KEY_VERSION,
    );
    return cached;
  },
};
