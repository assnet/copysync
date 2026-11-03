import { describe, expect, it, vi } from 'vitest';
import { storeInboundLinkPreview, type StoreInboundLinkPreviewInput } from './storeInboundLinkPreview';
import type { InboundLinkPreview } from './pickInboundLinkPreview';

const SMALL = Buffer.from([0xff, 0xd8, 0xff, 1]);
const BIG = Buffer.from([0xff, 0xd8, 0xff, 2, 2, 2]);

function make(over: Partial<StoreInboundLinkPreviewInput> = {}, preview: Partial<InboundLinkPreview> = {}) {
  const saveBuffer = vi.fn(async (buf: Buffer, name: string) => `/media/${name}#${buf.length}`);
  const downloadHq = vi.fn(async () => BIG);
  const allowHq = vi.fn(async () => true);
  const mediaExists = vi.fn(async () => false);
  const publicUrl = vi.fn((name: string) => `/media/${name}`);
  const logger = { warn: vi.fn() };
  const input: StoreInboundLinkPreviewInput = {
    preview: {
      url: 'https://loja.com/p',
      title: 'Produto',
      description: 'Desc',
      inlineThumb: SMALL,
      hq: { directPath: '/v/t62/x', mediaKey: new Uint8Array([1]) },
      ...preview,
    },
    sessionId: 's1',
    msgId: 'M1',
    saveThumbs: true,
    allowHq,
    store: { saveBuffer, mediaExists, publicUrl },
    downloadHq,
    logger,
    ...over,
  };
  return { input, saveBuffer, downloadHq, allowHq, logger, mediaExists };
}

describe('storeInboundLinkPreview', () => {
  it('download permitido: grava a pequena e sobrescreve com a grande no mesmo arquivo', async () => {
    const { input, saveBuffer } = make();
    const out = await storeInboundLinkPreview(input);
    expect(saveBuffer.mock.calls.map((c) => [c[0], c[1]])).toEqual([[SMALL, 's1_M1_lp.jpg'], [BIG, 's1_M1_lp.jpg']]);
    expect(out).toEqual({ url: 'https://loja.com/p', title: 'Produto', description: 'Desc', thumbnailUrl: '/media/s1_M1_lp.jpg#6' });
  });

  it('download desligado (grupo sem autoDownloadMedia): só a pequena, grande nem baixa', async () => {
    const { input, saveBuffer, downloadHq } = make({ allowHq: async () => false });
    const out = await storeInboundLinkPreview(input);
    expect(downloadHq).not.toHaveBeenCalled();
    expect(saveBuffer).toHaveBeenCalledTimes(1);
    expect(out.thumbnailUrl).toBe('/media/s1_M1_lp.jpg#4');
  });

  it('falha da grande mantém a pequena; log sem URL nem título', async () => {
    const { input, logger } = make({ downloadHq: async () => { throw new Error('boom'); } });
    const out = await storeInboundLinkPreview(input);
    expect(out.thumbnailUrl).toBe('/media/s1_M1_lp.jpg#4');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(logger.warn.mock.calls[0]);
    expect(logged).not.toContain('loja.com');
    expect(logged).not.toContain('Produto');
  });

  it('grande recusada (teto/tipo) mantém a pequena', async () => {
    const { input, saveBuffer } = make({ downloadHq: async () => null });
    expect((await storeInboundLinkPreview(input)).thumbnailUrl).toBe('/media/s1_M1_lp.jpg#4');
    expect(saveBuffer).toHaveBeenCalledTimes(1);
  });

  it('saveThumbs=false (histórico antigo): só textos, sem arquivo nem consulta da regra', async () => {
    const { input, saveBuffer, allowHq, downloadHq } = make({ saveThumbs: false });
    expect(await storeInboundLinkPreview(input)).toEqual({
      url: 'https://loja.com/p', title: 'Produto', description: 'Desc', thumbnailUrl: null,
    });
    expect(saveBuffer).not.toHaveBeenCalled();
    expect(allowHq).not.toHaveBeenCalled();
    expect(downloadHq).not.toHaveBeenCalled();
  });

  it('sem miniatura nenhuma: thumbnailUrl null, regra não consultada', async () => {
    const { input, saveBuffer, allowHq } = make({}, { inlineThumb: null, hq: null });
    expect((await storeInboundLinkPreview(input)).thumbnailUrl).toBeNull();
    expect(saveBuffer).not.toHaveBeenCalled();
    expect(allowHq).not.toHaveBeenCalled();
  });

  it('arquivo já existe: devolve a URL dele sem gravar nem baixar', async () => {
    const { input, saveBuffer, downloadHq, allowHq, mediaExists } = make();
    mediaExists.mockResolvedValueOnce(true);
    const out = await storeInboundLinkPreview(input);
    expect(mediaExists).toHaveBeenCalledWith('s1_M1_lp.jpg');
    expect(out.thumbnailUrl).toBe('/media/s1_M1_lp.jpg');
    expect(saveBuffer).not.toHaveBeenCalled();
    expect(downloadHq).not.toHaveBeenCalled();
    expect(allowHq).not.toHaveBeenCalled();
  });
});
