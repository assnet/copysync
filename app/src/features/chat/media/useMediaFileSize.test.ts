import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMediaFileSize, parseContentLength, resetMediaFileSizeCache } from './useMediaFileSize';

const headResponse = (ok: boolean, contentLength: string | null) =>
  Promise.resolve({ ok, headers: { get: (name: string) => (name === 'content-length' ? contentLength : null) } });

describe('parseContentLength — cabeçalho vira bytes', () => {
  it('aceita só inteiro não negativo', () => {
    expect(parseContentLength('2048')).toBe(2048);
    expect(parseContentLength(' 0 ')).toBe(0);
  });

  it('devolve null para ausente, vazio, negativo ou lixo', () => {
    expect(parseContentLength(null)).toBeNull();
    expect(parseContentLength(undefined)).toBeNull();
    expect(parseContentLength('')).toBeNull();
    expect(parseContentLength('-5')).toBeNull();
    expect(parseContentLength('12abc')).toBeNull();
    expect(parseContentLength('1.5')).toBeNull();
  });
});

describe('fetchMediaFileSize — HEAD com cache por URL', () => {
  beforeEach(() => {
    resetMediaFileSizeCache();
  });

  it('faz HEAD e lê o Content-Length', async () => {
    const head = vi.fn(() => headResponse(true, '2000000'));
    await expect(fetchMediaFileSize('/api/storage/media/a.zip', head)).resolves.toBe(2_000_000);
    expect(head).toHaveBeenCalledWith('/api/storage/media/a.zip', { method: 'HEAD' });
  });

  it('a mesma URL só consulta uma vez, mesmo com chamadas simultâneas', async () => {
    const head = vi.fn(() => headResponse(true, '10'));
    const [a, b] = await Promise.all([
      fetchMediaFileSize('/m/x.pdf', head),
      fetchMediaFileSize('/m/x.pdf', head),
    ]);
    await fetchMediaFileSize('/m/x.pdf', head);
    expect([a, b]).toEqual([10, 10]);
    expect(head).toHaveBeenCalledTimes(1);
  });

  it('resposta sem sucesso ou sem cabeçalho vira null e fica em cache', async () => {
    const semCabecalho = vi.fn(() => headResponse(true, null));
    await expect(fetchMediaFileSize('/m/a', semCabecalho)).resolves.toBeNull();

    const erro404 = vi.fn(() => headResponse(false, '99'));
    await expect(fetchMediaFileSize('/m/b', erro404)).resolves.toBeNull();
    await fetchMediaFileSize('/m/b', erro404);
    expect(erro404).toHaveBeenCalledTimes(1);
  });

  it('falha de rede é silenciosa', async () => {
    const rede = vi.fn(() => Promise.reject(new Error('Network Error')));
    await expect(fetchMediaFileSize('/m/c', rede)).resolves.toBeNull();
  });

  it('sem fetch no ambiente devolve null sem lançar', async () => {
    await expect(fetchMediaFileSize('/m/d', undefined)).resolves.toBeNull();
  });
});
