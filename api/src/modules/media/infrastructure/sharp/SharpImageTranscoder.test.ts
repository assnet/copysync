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
});
