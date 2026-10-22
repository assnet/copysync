import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { EncryptedBlob, ISecretCipher } from './ISecretCipher';
import { SecretCipherFailedError } from '../errors/internal/SecretCipherErrors';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM com Node `crypto`. Recebe as chaves por versão; cifra sempre com `currentVersion`
 * e decifra com a versão gravada no blob.
 */
export class AesGcmSecretCipher implements ISecretCipher {
  constructor(
    private readonly keys: ReadonlyMap<number, Buffer>,
    private readonly currentVersion: number,
  ) {
    if (!keys.has(currentVersion)) throw new Error('Current key version has no key');
  }

  encrypt(plain: string, aad: string): EncryptedBlob {
    const key = this.keys.get(this.currentVersion)!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return { ciphertext, iv, tag: cipher.getAuthTag(), keyVersion: this.currentVersion };
  }

  decrypt(blob: EncryptedBlob, aad: string): string {
    const key = this.keys.get(blob.keyVersion);
    if (!key) throw new SecretCipherFailedError();
    try {
      const decipher = createDecipheriv(ALGORITHM, key, blob.iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(blob.tag);
      return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new SecretCipherFailedError();
    }
  }
}
