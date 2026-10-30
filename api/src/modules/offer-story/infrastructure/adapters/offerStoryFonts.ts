import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SatoriOptions } from 'satori';

export type OfferStoryFont = SatoriOptions['fonts'][number];

type FontFile = { file: string; name: string; weight: 400 | 700 | 800 };

/**
 * Fontes OFL em `api/assets/offer-story/fonts/` (copiadas no Dockerfile). Resolvido por `__dirname`
 * (mesma profundidade em `src/` e `dist/`, `rootDir: src`), não por `process.cwd()`.
 */
export const OFFER_STORY_FONTS_DIR = path.resolve(__dirname, '../../../../../assets/offer-story/fonts');

const FONT_FILES: readonly FontFile[] = [
  { file: 'inter-latin-400-normal.woff', name: 'Inter', weight: 400 },
  { file: 'inter-latin-700-normal.woff', name: 'Inter', weight: 700 },
  { file: 'inter-latin-800-normal.woff', name: 'Inter', weight: 800 },
  { file: 'anton-latin-400-normal.woff', name: 'Anton', weight: 400 },
  { file: 'pacifico-latin-400-normal.woff', name: 'Pacifico', weight: 400 },
];

let cached: Promise<OfferStoryFont[]> | null = null;

/** Lê as fontes uma vez por processo (lazy). Falha de leitura limpa o memo para tentar de novo. */
export function loadOfferStoryFonts(): Promise<OfferStoryFont[]> {
  if (!cached) {
    const dir = OFFER_STORY_FONTS_DIR;
    cached = Promise.all(
      FONT_FILES.map(async ({ file, name, weight }) => ({
        name,
        weight,
        style: 'normal' as const,
        data: await readFile(path.join(dir, file)),
      })),
    ).catch((err: unknown) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}
