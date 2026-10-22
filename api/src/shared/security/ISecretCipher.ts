/** Segredo cifrado em repouso. `keyVersion` diz qual chave decifra (rotação futura). */
export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyVersion: number;
}

/**
 * Cifra simétrica autenticada. `aad` amarra o blob ao contexto (ex. `tenantId:provider:secret`):
 * blob copiado para outra linha ou coluna não decifra.
 */
export interface ISecretCipher {
  encrypt(plain: string, aad: string): EncryptedBlob;
  /** Lança `SecretCipherFailedError` se a chave, o AAD ou o blob não baterem. */
  decrypt(blob: EncryptedBlob, aad: string): string;
}
