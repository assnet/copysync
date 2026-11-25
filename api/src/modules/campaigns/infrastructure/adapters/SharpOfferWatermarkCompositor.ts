import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import sharp from 'sharp';
import type {
  IOfferWatermarkCompositor,
  OfferWatermarkLayout,
  OfferWatermarkMark,
} from '../../domain/contracts/IOfferWatermarkCompositor';
import { computeWatermarkPlacement } from '../../domain/services/computeWatermarkPlacement';
import { loadOfferStoryFonts } from '../../../offer-story/infrastructure/adapters/offerStoryFonts';

/** Fonte do texto da marca (bytes `.woff`/`.ttf` que o satori lê). */
export interface WatermarkTextFont {
  name: string;
  weight: 400 | 700 | 800 | 900;
  data: Buffer;
}

export interface SharpOfferWatermarkCompositorDeps {
  /** Padrão: Inter 800 empacotada em `api/assets/offer-story/fonts/` (a mesma do Story). */
  textFont?: () => Promise<WatermarkTextFont>;
}

const PHOTO_MAX_PIXELS = 40e6;
/** Texto desenhado grande e reduzido ao tamanho da marca: contorno nítido em qualquer foto. */
const TEXT_FONT_SIZE = 120;
const TEXT_PADDING = 28;
const TEXT_COLOR = '#FFFFFF';
/** Sombra escura em volta (lê sobre foto clara) + sombra projetada (lê sobre foto escura). */
const TEXT_SHADOW = '0 0 10px rgba(0,0,0,0.9), 0 4px 14px rgba(0,0,0,0.7)';
const OUTPUT_QUALITY = 90;

/** Inter 800 do pacote do Story (memo do próprio carregador; asset estático, não estado). */
async function packagedTextFont(): Promise<WatermarkTextFont> {
  const fonts = await loadOfferStoryFonts();
  const inter = fonts.find((f) => f.name === 'Inter' && f.weight === 800);
  if (!inter) throw new Error('Watermark font missing');
  return { name: inter.name, weight: 800, data: Buffer.isBuffer(inter.data) ? inter.data : Buffer.from(inter.data) };
}

/**
 * Texto da marca em PNG transparente, recortado ao conteúdo (texto + sombra). Satori converte os
 * glifos em contornos a partir dos bytes da fonte recebida e o resvg rasteriza: não existe fonte
 * do sistema nesse caminho (o `text` do sharp com `.woff` caía no fallback do sistema).
 */
export async function renderWatermarkText(text: string, font: WatermarkTextFont): Promise<Buffer> {
  const node = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        padding: TEXT_PADDING,
        fontFamily: font.name,
        fontWeight: font.weight,
        fontSize: TEXT_FONT_SIZE,
        color: TEXT_COLOR,
        textShadow: TEXT_SHADOW,
        whiteSpace: 'nowrap',
      },
      children: text,
    },
  };
  // Só a altura: o satori calcula a largura do texto (uma linha, até 32 caracteres)
  const svg = await satori(node as Parameters<typeof satori>[0], {
    height: TEXT_FONT_SIZE + TEXT_PADDING * 2 + 24,
    fonts: [{ name: font.name, weight: font.weight, style: 'normal', data: font.data }],
  });
  const png = new Resvg(svg).render().asPng();
  return sharp(png).trim().png().toBuffer();
}

/** Multiplica o canal alfa por `opacity` (20–100 %), preservando o recorte da marca. */
async function withOpacity(png: Buffer, opacity: number): Promise<Buffer> {
  if (opacity >= 100) return png;
  const alpha = Math.max(0, Math.min(255, Math.round((255 * opacity) / 100)));
  return sharp(png)
    .composite([{ input: Buffer.from([0, 0, 0, alpha]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/**
 * Marca d'água sobre a foto da oferta (logo ou texto), em JPEG do tamanho da foto. Lugar e tamanho
 * por `computeWatermarkPlacement`; transparência da foto vira fundo branco (como o `toJpeg`).
 */
export class SharpOfferWatermarkCompositor implements IOfferWatermarkCompositor {
  constructor(private readonly deps: SharpOfferWatermarkCompositorDeps = {}) {}

  async compose(photo: Buffer, mark: OfferWatermarkMark, layout: OfferWatermarkLayout): Promise<Buffer> {
    const meta = await sharp(photo, { limitInputPixels: PHOTO_MAX_PIXELS }).metadata();
    if (!meta.width || !meta.height) throw new Error('Photo without dimensions');
    // Orientação EXIF 5–8 gira 90°: o lugar da marca vale para a foto como é exibida
    const swap = (meta.orientation ?? 1) >= 5;
    const dims = swap ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };

    const source = mark.kind === 'IMAGE'
      ? mark.logo
      : await renderWatermarkText(mark.text, await (this.deps.textFont ?? packagedTextFont)());
    const markMeta = await sharp(source, { limitInputPixels: PHOTO_MAX_PIXELS }).metadata();
    if (!markMeta.width || !markMeta.height) throw new Error('Watermark without dimensions');

    const place = computeWatermarkPlacement(dims, { width: markMeta.width, height: markMeta.height }, layout.position, layout.size);
    const resized = await sharp(source).ensureAlpha().resize(place.width, place.height, { fit: 'fill' }).png().toBuffer();
    const overlay = await withOpacity(resized, layout.opacity);

    return sharp(photo, { limitInputPixels: PHOTO_MAX_PIXELS })
      .rotate()
      .composite([{ input: overlay, left: place.left, top: place.top }])
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: OUTPUT_QUALITY, mozjpeg: true })
      .toBuffer();
  }
}
