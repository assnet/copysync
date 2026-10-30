import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import sharp from 'sharp';
import type {
  IOfferStoryRenderer,
  OfferStoryRenderInput,
  RenderedOfferStory,
} from '../../domain/contracts/IOfferStoryRenderer';
import { MediaProcessingFailedError, MediaProcessorUnavailableError } from '../../../../shared/errors/internal/MediaErrors';
import { loadOfferStoryFonts } from './offerStoryFonts';
import { OFFER_STORY_LAYOUTS } from './templates/offerStoryLayouts';
import { STORY_IMAGE_BOX, type StoryLayoutModel } from './templates/storyLayoutModel';
import { formatStoryCents } from './templates/storyPrimitives';

const MAX_CONCURRENT_RENDERS = 2;
/** Fila máxima por processo: cada espera segura a foto (até 5 MiB) e a requisição aberta. */
const MAX_WAITING_RENDERS = 8;
const PRODUCT_IMAGE_MAX = 800;

/**
 * Fila simples de vagas. Limita CPU por processo; não é estado operacional (nada a persistir).
 * Ao liberar, a vaga passa direto para quem espera (sem decrementar), senão uma chamada nova
 * entre o `resolve` e o microtask seguinte furaria o limite. Fila cheia → 503.
 */
export class RenderSlots {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly max: number,
    private readonly maxWaiting: number,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.max) {
      this.active += 1;
    } else {
      if (this.waiting.length >= this.maxWaiting) throw new MediaProcessorUnavailableError('Story renderer is busy');
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

type PreparedImage = StoryLayoutModel['image'];

/** Abre qualquer formato do sharp, corrige EXIF, limita a 800px e encaixa (contain) na caixa do card. */
async function prepareProductImage(buf: Buffer): Promise<PreparedImage> {
  const { data, info } = await sharp(buf, { limitInputPixels: 40e6 })
    .rotate()
    .resize(PRODUCT_IMAGE_MAX, PRODUCT_IMAGE_MAX, { fit: 'inside' })
    .png()
    .toBuffer({ resolveWithObject: true });
  const scale = Math.min(STORY_IMAGE_BOX.width / info.width, STORY_IMAGE_BOX.height / info.height);
  return {
    src: `data:image/png;base64,${data.toString('base64')}`,
    width: Math.max(1, Math.round(info.width * scale)),
    height: Math.max(1, Math.round(info.height * scale)),
  };
}

/** Nome + código (ex.: `Error:ENOENT` de fonte ausente), sem mensagem nem caminho de disco. */
function errorReason(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown';
  const code = (err as NodeJS.ErrnoException).code;
  return code ? `${err.name}:${code}` : err.name;
}

export class SatoriOfferStoryRenderer implements IOfferStoryRenderer {
  private readonly slots = new RenderSlots(MAX_CONCURRENT_RENDERS, MAX_WAITING_RENDERS);

  render(input: OfferStoryRenderInput): Promise<RenderedOfferStory> {
    return this.slots.run(() => this.renderNow(input));
  }

  private async renderNow(input: OfferStoryRenderInput): Promise<RenderedOfferStory> {
    const { template } = input;
    const layout = OFFER_STORY_LAYOUTS[template.id];
    if (!layout) throw new MediaProcessingFailedError('Story template has no layout', { templateId: template.id });

    let image: PreparedImage = null;
    let imageDropped = false;
    if (input.productImage) {
      try {
        image = await prepareProductImage(input.productImage);
      } catch {
        imageDropped = true;
      }
    }

    const { fromCents, toCents } = input.price;
    const model: StoryLayoutModel = {
      width: template.width,
      height: template.height,
      title: input.headline.trim(),
      image,
      toLabel: toCents !== null ? formatStoryCents(toCents) : null,
      fromLabel: toCents !== null && fromCents !== null && fromCents > toCents ? formatStoryCents(fromCents) : null,
      coupon: input.coupon
        ? {
            code: input.coupon.code,
            discountLabel: input.coupon.discountPercent !== null ? `-${input.coupon.discountPercent}%` : null,
          }
        : null,
    };

    try {
      const fonts = await loadOfferStoryFonts();
      // A árvore em objetos simples é o formato que o satori consome; o tipo dele exige ReactNode.
      const svg = await satori(layout(model) as Parameters<typeof satori>[0], {
        width: template.width,
        height: template.height,
        fonts,
      });
      const png = new Resvg(svg, { fitTo: { mode: 'width', value: template.width } }).render().asPng();
      const buffer = await sharp(png).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      return { buffer, mimeType: 'image/jpeg', width: template.width, height: template.height, imageDropped };
    } catch (err) {
      throw new MediaProcessingFailedError('Story render failed', {
        templateId: template.id,
        reason: errorReason(err),
      });
    }
  }
}
