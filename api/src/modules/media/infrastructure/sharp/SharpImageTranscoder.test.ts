import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { SharpImageTranscoder } from './SharpImageTranscoder';
import { MediaProcessingFailedError } from '../../../../shared/errors/internal/MediaErrors';

const created: string[] = [];
const tmp = (ext: string) => {
  const p = path.join(os.tmpdir(), `transcoder-test-${randomUUID()}.${ext}`);
  created.push(p);
  return p;
};

afterEach(async () => {
  await Promise.all(created.splice(0).map((p) => fs.rm(p, { force: true })));
});

describe('SharpImageTranscoder', () => {
  it('converte WebP com transparência em JPEG com fundo branco', async () => {
    const src = tmp('webp');
    await sharp({ create: { width: 40, height: 30, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } })
      .webp().toFile(src);
    const out = tmp('jpg');

    await new SharpImageTranscoder().toJpeg(src, out);

    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([40, 30]);
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240); // transparente virou branco, não preto
  });

  it('arquivo que não é imagem vira MediaProcessingFailedError', async () => {
    const src = tmp('webp');
    await fs.writeFile(src, 'não é imagem');
    await expect(new SharpImageTranscoder().toJpeg(src, tmp('jpg'))).rejects.toBeInstanceOf(MediaProcessingFailedError);
  });

  describe('resizeJpeg', () => {
    const t = new SharpImageTranscoder();

    it('PNG 2000×1000 em Buffer → JPEG com lado maior 600', async () => {
      const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#3366cc' } }).png().toBuffer();
      const out = await t.resizeJpeg(png, 600, 75);
      const meta = await sharp(out.buffer).metadata();
      expect(meta.format).toBe('jpeg');
      expect([out.width, out.height]).toEqual([600, 300]);
      expect([meta.width, meta.height]).toEqual([600, 300]);
    });

    it('WebP por caminho → JPEG', async () => {
      const src = tmp('webp');
      await sharp({ create: { width: 800, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .webp().toFile(src);
      const out = await t.resizeJpeg(src, 600, 75);
      expect((await sharp(out.buffer).metadata()).format).toBe('jpeg');
      expect([out.width, out.height]).toEqual([400, 600]);
    });

    it('imagem pequena não aumenta', async () => {
      const png = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#fff' } }).png().toBuffer();
      const out = await t.resizeJpeg(png, 600, 75);
      expect([out.width, out.height]).toEqual([120, 80]);
    });

    it('bytes que não são imagem → MediaProcessingFailedError', async () => {
      await expect(t.resizeJpeg(Buffer.from('nada'), 600, 75)).rejects.toBeInstanceOf(MediaProcessingFailedError);
    });
  });
});
