import { describe, expect, it, vi } from 'vitest';
import { OfferWatermarkMediaStore } from './OfferWatermarkMediaStore';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';

const KEY = 'offer-watermark-0b8c1f2e-1234-4abc-9def-0123456789ab.png';

function setup(acquired: boolean) {
  const release = vi.fn(async () => undefined);
  const files = {
    publicUrl: vi.fn((name: string) => `/api/storage/media/${name}`),
    acquireLocalFile: vi.fn(async () => (acquired ? { filePath: '/m/logo.png', sizeBytes: 3, release } : null)),
  };
  const readFile = vi.fn(async () => Buffer.from('png'));
  const store = new OfferWatermarkMediaStore({ files: () => files as unknown as IMediaFileStore, readFile });
  return { store, files, readFile, release };
}

describe('OfferWatermarkMediaStore.read', () => {
  it('lê o logo pela chave e libera o arquivo', async () => {
    const s = setup(true);
    await expect(s.store.read(KEY)).resolves.toEqual(Buffer.from('png'));
    expect(s.files.acquireLocalFile).toHaveBeenCalledWith(`/api/storage/media/${KEY}`);
    expect(s.readFile).toHaveBeenCalledWith('/m/logo.png');
    expect(s.release).toHaveBeenCalledOnce();
  });

  it('arquivo sumido: null', async () => {
    await expect(setup(false).store.read(KEY)).resolves.toBeNull();
  });

  it.each(['../etc/passwd', 'offer-1.jpg', `x/${KEY}`])('chave fora do formato (%s): null sem tocar o storage', async (key) => {
    const s = setup(true);
    await expect(s.store.read(key)).resolves.toBeNull();
    expect(s.files.acquireLocalFile).not.toHaveBeenCalled();
  });

  it('storage fora: erro sobe para quem decora', async () => {
    const s = setup(true);
    s.files.acquireLocalFile.mockRejectedValueOnce(new Error('s3 down'));
    await expect(s.store.read(KEY)).rejects.toThrow('s3 down');
  });
});
