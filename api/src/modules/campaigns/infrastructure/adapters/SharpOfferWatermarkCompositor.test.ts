import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { SharpOfferWatermarkCompositor, renderWatermarkText, type WatermarkTextFont } from './SharpOfferWatermarkCompositor';
import { OFFER_STORY_FONTS_DIR } from '../../../offer-story/infrastructure/adapters/offerStoryFonts';
import { computeWatermarkPlacement } from '../../domain/services/computeWatermarkPlacement';
import type { OfferWatermarkLayout } from '../../domain/contracts/IOfferWatermarkCompositor';

const W = 600;
const H = 400;
const GRAY = { r: 128, g: 128, b: 128 };

async function photo(format: 'jpeg' | 'png' | 'webp', background: { r: number; g: number; b: number } = GRAY): Promise<Buffer> {
  const img = sharp({ create: { width: W, height: H, channels: 3, background } });
  return format === 'jpeg' ? img.jpeg().toBuffer() : format === 'png' ? img.png().toBuffer() : img.webp().toBuffer();
}
const redLogo = () => sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();

async function raw(buf: Buffer) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
  };
  return { info, at, data };
}
const near = (a: number, b: number, tol = 12) => Math.abs(a - b) <= tol;
/** Luminância mínima e máxima dentro do retângulo da marca. */
async function lumRange(buf: Buffer, rect: { left: number; top: number; width: number; height: number }) {
  const { at } = await raw(buf);
  let min = 255;
  let max = 0;
  for (let y = rect.top; y < rect.top + rect.height; y++) {
    for (let x = rect.left; x < rect.left + rect.width; x++) {
      const p = at(x, y);
      const l = 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
      min = Math.min(min, l);
      max = Math.max(max, l);
    }
  }
  return { min, max };
}

const compositor = new SharpOfferWatermarkCompositor();
const topLeft: OfferWatermarkLayout = { position: 'TOP_LEFT', size: 'MEDIUM', opacity: 100 };

describe('SharpOfferWatermarkCompositor — logo', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('%s: canto escolhido muda, canto oposto não; sai JPEG do mesmo tamanho', async (fmt) => {
    const out = await compositor.compose(await photo(fmt), { kind: 'IMAGE', logo: await redLogo() }, topLeft);
    const meta = await sharp(out).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', W, H]);
    const place = computeWatermarkPlacement({ width: W, height: H }, { width: 200, height: 200 }, 'TOP_LEFT', 'MEDIUM');
    const { at } = await raw(out);
    const inside = at(place.left + Math.floor(place.width / 2), place.top + Math.floor(place.height / 2));
    expect(inside.r).toBeGreaterThan(200);
    expect(inside.g).toBeLessThan(60);
    const opposite = at(W - 10, H - 10);
    expect([near(opposite.r, 128), near(opposite.g, 128), near(opposite.b, 128)]).toEqual([true, true, true]);
  });

  it.each(['TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT', 'CENTER'] as const)('posição %s cai onde o cálculo manda', async (position) => {
    const out = await compositor.compose(await photo('png'), { kind: 'IMAGE', logo: await redLogo() }, { ...topLeft, position });
    const place = computeWatermarkPlacement({ width: W, height: H }, { width: 200, height: 200 }, position, 'MEDIUM');
    const { at } = await raw(out);
    expect(at(place.left + 5, place.top + 5).r).toBeGreaterThan(200);
    expect(near(at(5, 5).r, 128)).toBe(true); // canto superior esquerdo intacto
  });

  it('opacidade 20 × 100 gera pixels distintos (20 % fica perto da foto)', async () => {
    const src = await photo('png');
    const logo = await redLogo();
    const place = computeWatermarkPlacement({ width: W, height: H }, { width: 200, height: 200 }, 'TOP_LEFT', 'MEDIUM');
    const cx = place.left + Math.floor(place.width / 2);
    const cy = place.top + Math.floor(place.height / 2);
    const full = (await raw(await compositor.compose(src, { kind: 'IMAGE', logo }, topLeft))).at(cx, cy);
    const faint = (await raw(await compositor.compose(src, { kind: 'IMAGE', logo }, { ...topLeft, opacity: 20 }))).at(cx, cy);
    expect(full.r - faint.r).toBeGreaterThan(60);
    // 20 %: 0,8 × 128 + 0,2 × 255 ≈ 153 no vermelho; 0,8 × 128 ≈ 102 no verde
    expect(near(faint.r, 153, 15)).toBe(true);
    expect(near(faint.g, 102, 15)).toBe(true);
  });

  it('logo corrompido: lança (quem decora envia sem a marca)', async () => {
    await expect(compositor.compose(await photo('jpeg'), { kind: 'IMAGE', logo: Buffer.from('not a png') }, topLeft)).rejects.toThrow();
  });
});

describe('SharpOfferWatermarkCompositor — texto', () => {
  const font = async (file: string, name: string, weight: WatermarkTextFont['weight']): Promise<WatermarkTextFont> =>
    ({ name, weight, data: await readFile(path.join(OFFER_STORY_FONTS_DIR, file)) });
  const TEXT = 'Promoções São João';

  it('legível sobre foto clara e escura (texto claro + sombra escura)', async () => {
    const mark = { kind: 'TEXT' as const, text: TEXT };
    const markPng = await renderWatermarkText(TEXT, await font('inter-latin-800-normal.woff', 'Inter', 800));
    const mm = await sharp(markPng).metadata();
    const place = computeWatermarkPlacement({ width: W, height: H }, { width: mm.width!, height: mm.height! }, 'BOTTOM_RIGHT', 'LARGE');
    const layout: OfferWatermarkLayout = { position: 'BOTTOM_RIGHT', size: 'LARGE', opacity: 100 };

    const onWhite = await compositor.compose(await photo('jpeg', { r: 255, g: 255, b: 255 }), mark, layout);
    const onBlack = await compositor.compose(await photo('jpeg', { r: 0, g: 0, b: 0 }), mark, layout);
    expect((await lumRange(onWhite, place)).min).toBeLessThan(110); // sombra aparece no branco
    expect((await lumRange(onBlack, place)).max).toBeGreaterThan(200); // letra clara aparece no preto
    // Fora da marca a foto segue igual
    expect((await raw(onWhite)).at(10, 10).r).toBeGreaterThan(245);
  });

  it('fonte empacotada carregada de fato: Inter × Pacifico geram imagens diferentes', async () => {
    const inter = await renderWatermarkText(TEXT, await font('inter-latin-800-normal.woff', 'Inter', 800));
    const pacifico = await renderWatermarkText(TEXT, await font('pacifico-latin-400-normal.woff', 'Pacifico', 400));
    const a = await sharp(inter).metadata();
    const b = await sharp(pacifico).metadata();
    expect([a.width, a.height]).not.toEqual([b.width, b.height]);
  });

  it('padrão do compositor = Inter 800 de api/assets (mesmos pixels do render explícito)', async () => {
    const explicit = new SharpOfferWatermarkCompositor({ textFont: () => font('inter-latin-800-normal.woff', 'Inter', 800) });
    const src = await photo('png');
    const mark = { kind: 'TEXT' as const, text: TEXT };
    const viaDefault = await compositor.compose(src, mark, topLeft);
    const viaExplicit = await explicit.compose(src, mark, topLeft);
    expect(viaDefault.equals(viaExplicit)).toBe(true);
  });

  it('sem fallback de sistema: fonte ilegível lança em vez de desenhar com outra', async () => {
    const broken = new SharpOfferWatermarkCompositor({ textFont: async () => ({ name: 'Inter', weight: 800, data: Buffer.from('xx') }) });
    await expect(broken.compose(await photo('png'), { kind: 'TEXT', text: TEXT }, topLeft)).rejects.toThrow();
  });

  it('acentos desenhados: "São João" difere de "Sao Joao"', async () => {
    const f = await font('inter-latin-800-normal.woff', 'Inter', 800);
    const withAccents = await renderWatermarkText('São João', f);
    const without = await renderWatermarkText('Sao Joao', f);
    const a = await raw(withAccents);
    const b = await raw(without);
    // Mesma largura de avanço, mas o til sobe a altura do recorte (ou muda os pixels)
    expect(a.info.height !== b.info.height || !a.data.equals(b.data)).toBe(true);
    expect(a.info.height).toBeGreaterThan(b.info.height);
  });
});
