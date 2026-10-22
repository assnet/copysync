import { describe, it, expect, vi, afterEach } from 'vitest';

async function loadFactory(key: string | undefined) {
  vi.resetModules();
  if (key === undefined) vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', undefined as unknown as string);
  else vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', key);
  return (await import('./SecretCipherFactory')).SecretCipherFactory;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('SecretCipherFactory', () => {
  it('chave válida: cifra disponível', async () => {
    const f = await loadFactory(Buffer.alloc(32, 3).toString('base64'));
    expect(f.check()).toBeNull();
    expect(() => f.get()).not.toThrow();
  });

  it.each([
    ['ausente', undefined],
    ['vazia', ''],
    ['só espaços', '   '],
    ['curta', Buffer.alloc(8, 1).toString('base64')],
  ])('chave %s: env carrega (boot segue) e só a cifra responde 503', async (_label, key) => {
    const f = await loadFactory(key);
    expect(f.check()).not.toBeNull();
    const err = (() => { try { f.get(); } catch (e) { return e; } })();
    // resetModules recria a classe do erro: compara pelo contrato, não por instanceof.
    expect(err).toMatchObject({ code: 'SECRET_CIPHER_UNAVAILABLE', statusCode: 503 });
  });
});
