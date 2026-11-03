import { describe, expect, it, vi } from 'vitest';
import { downloadLinkPreviewThumb, LINK_PREVIEW_HQ_THUMB_MAX_BYTES, readStreamCapped } from './downloadLinkPreviewThumb';

const jpeg = (size: number) => {
  const b = Buffer.alloc(size);
  b.set([0xff, 0xd8, 0xff]);
  return b;
};

/** Stream fake: conta quantos pedaços foram entregues e registra o destroy. */
function fakeStream(chunks: Buffer[]) {
  const state = { yielded: 0, destroy: vi.fn() };
  const stream = {
    destroy: state.destroy,
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) {
        state.yielded++;
        yield c;
      }
    },
  };
  return { stream, state };
}

describe('readStreamCapped', () => {
  it('dentro do teto junta os pedaços', async () => {
    const { stream, state } = fakeStream([Buffer.from([1, 2]), Buffer.from([3])]);
    expect(await readStreamCapped(stream, 3)).toEqual(Buffer.from([1, 2, 3]));
    expect(state.destroy).not.toHaveBeenCalled();
  });

  it('passou do teto: destroy no pedaço que estourou, null, não lê o resto', async () => {
    const half = Buffer.alloc(LINK_PREVIEW_HQ_THUMB_MAX_BYTES / 2 + 1);
    const { stream, state } = fakeStream([half, half, half]);
    expect(await readStreamCapped(stream, LINK_PREVIEW_HQ_THUMB_MAX_BYTES)).toBeNull();
    expect(state.destroy).toHaveBeenCalledTimes(1);
    expect(state.yielded).toBe(2);
  });
});

describe('downloadLinkPreviewThumb', () => {
  const hq = { directPath: '/v/t62/x', mediaKey: new Uint8Array([1]) };

  it('baixa como thumbnail-link e devolve o JPEG', async () => {
    const download = vi.fn(async () => fakeStream([jpeg(50)]).stream);
    const out = await downloadLinkPreviewThumb(hq, download);
    expect(download).toHaveBeenCalledWith({ directPath: '/v/t62/x', mediaKey: hq.mediaKey }, 'thumbnail-link');
    expect(out?.length).toBe(50);
  });

  it('não é JPEG → null', async () => {
    const download = vi.fn(async () => fakeStream([Buffer.from([0x89, 0x50, 0x4e, 0x47])]).stream);
    expect(await downloadLinkPreviewThumb(hq, download)).toBeNull();
  });

  it('acima de 1 MiB → null com destroy', async () => {
    const { stream, state } = fakeStream([jpeg(LINK_PREVIEW_HQ_THUMB_MAX_BYTES), Buffer.alloc(1)]);
    expect(await downloadLinkPreviewThumb(hq, async () => stream)).toBeNull();
    expect(state.destroy).toHaveBeenCalled();
  });
});
