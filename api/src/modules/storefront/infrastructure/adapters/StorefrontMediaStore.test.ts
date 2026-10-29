import { describe, it, expect, vi } from 'vitest';
import { StorefrontMediaStore } from './StorefrontMediaStore';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';

const NAME = 'storefront-123e4567-e89b-42d3-a456-426614174000.webp';

function setup(localPath: string | null = null) {
  const files = {
    saveBuffer: vi.fn(async (_b: Buffer, name: string) => `https://cdn/media/${name}`),
    resolveLocalPath: vi.fn(() => localPath),
    remove: vi.fn(async () => undefined),
  };
  const store = new StorefrontMediaStore({ files: () => files as unknown as IMediaFileStore });
  return { store, files };
}

describe('StorefrontMediaStore', () => {
  it('save grava storefront-<uuid>.webp e devolve a URL', async () => {
    const { store, files } = setup();
    const url = await store.save(Buffer.from('x'));
    expect(url).toMatch(/\/storefront-[0-9a-f-]{36}\.webp$/);
    expect(files.saveBuffer.mock.calls[0]?.[1]).toMatch(/^storefront-[0-9a-f-]{36}\.webp$/);
  });

  it('remove apaga só nome no padrão, resolvendo caminho local', async () => {
    const { store, files } = setup('/data/media/' + NAME);
    await store.remove(`https://cdn/media/${NAME}?v=1`);
    expect(files.remove).toHaveBeenCalledWith('/data/media/' + NAME);
  });

  it('remove em store remoto usa a própria URL', async () => {
    const { store, files } = setup(null);
    await store.remove(`https://cdn/media/${NAME}`);
    expect(files.remove).toHaveBeenCalledWith(`https://cdn/media/${NAME}`);
  });

  it('remove ignora URL fora do padrão', async () => {
    const { store, files } = setup();
    for (const url of [
      'https://cdn/media/offer-123e4567-e89b-42d3-a456-426614174000.jpg',
      'https://cdn/media/storefront-abc.webp',
      `https://cdn/media/x${NAME}`,
      `https://cdn/media/${NAME}.png`,
      '',
    ]) {
      await store.remove(url);
    }
    expect(files.remove).not.toHaveBeenCalled();
  });

  it('falha ao remover não lança', async () => {
    const { store, files } = setup();
    files.remove.mockRejectedValueOnce(new Error('boom'));
    await expect(store.remove(`https://cdn/media/${NAME}`)).resolves.toBeUndefined();
  });
});
