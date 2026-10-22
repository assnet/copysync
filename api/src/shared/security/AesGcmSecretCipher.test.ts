import { describe, it, expect } from 'vitest';
import { AesGcmSecretCipher } from './AesGcmSecretCipher';
import { describeKeyProblem } from './SecretCipherFactory';
import { SecretCipherFailedError } from '../errors/internal/SecretCipherErrors';

const KEY = Buffer.alloc(32, 1);
const cipher = new AesGcmSecretCipher(new Map([[1, KEY]]), 1);
const AAD = 'tenant-1:SHOPEE:secret';

describe('AesGcmSecretCipher', () => {
  it('cifra e decifra o mesmo valor, sem guardar o texto em claro', () => {
    const blob = cipher.encrypt('minha-secret', AAD);

    expect(blob.ciphertext.toString('utf8')).not.toContain('minha-secret');
    expect(blob.iv).toHaveLength(12);
    expect(blob.tag).toHaveLength(16);
    expect(blob.keyVersion).toBe(1);
    expect(cipher.decrypt(blob, AAD)).toBe('minha-secret');
  });

  it('mesmo valor cifrado duas vezes gera blobs diferentes (iv aleatório)', () => {
    const a = cipher.encrypt('x', AAD);
    const b = cipher.encrypt('x', AAD);
    expect(a.ciphertext.equals(b.ciphertext) && a.iv.equals(b.iv)).toBe(false);
  });

  it('tag adulterada não decifra', () => {
    const blob = cipher.encrypt('minha-secret', AAD);
    blob.tag[0] ^= 0xff;
    expect(() => cipher.decrypt(blob, AAD)).toThrow(SecretCipherFailedError);
  });

  it('blob de outro tenant ou de outra coluna não decifra', () => {
    const blob = cipher.encrypt('minha-secret', AAD);
    expect(() => cipher.decrypt(blob, 'tenant-2:SHOPEE:secret')).toThrow(SecretCipherFailedError);
    expect(() => cipher.decrypt(blob, 'tenant-1:SHOPEE:session')).toThrow(SecretCipherFailedError);
  });

  it('chave errada ou versão desconhecida não decifra', () => {
    const blob = cipher.encrypt('minha-secret', AAD);
    const other = new AesGcmSecretCipher(new Map([[1, Buffer.alloc(32, 2)]]), 1);
    expect(() => other.decrypt(blob, AAD)).toThrow(SecretCipherFailedError);
    expect(() => cipher.decrypt({ ...blob, keyVersion: 9 }, AAD)).toThrow(SecretCipherFailedError);
  });
});

describe('describeKeyProblem', () => {
  it('chave de 32 bytes em base64 serve', () => {
    expect(describeKeyProblem(KEY.toString('base64'))).toBeNull();
  });

  it('chave ausente ou curta é tratada como indisponível, sem expor o valor', () => {
    expect(describeKeyProblem(undefined)).toBe('missing');
    const curta = Buffer.alloc(16, 1).toString('base64');
    const problem = describeKeyProblem(curta);
    expect(problem).toMatch(/32 bytes/);
    expect(problem).not.toContain(curta);
  });
});
