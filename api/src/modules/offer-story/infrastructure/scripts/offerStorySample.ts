import sharp from 'sharp';
import type { OfferStoryRenderInput } from '../../domain/contracts/IOfferStoryRenderer';
import type { OfferStoryTemplate } from '../../domain/offerStoryTemplates';

/** Foto genérica (fone desenhado em SVG) para thumbnails e testes; nenhum produto real. */
const SAMPLE_PRODUCT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
<rect width="800" height="800" fill="#FFFFFF"/>
<path d="M200 470 C 200 230, 600 230, 600 470" fill="none" stroke="#2B2F3A" stroke-width="48" stroke-linecap="round"/>
<rect x="140" y="420" width="140" height="230" rx="60" fill="#3A4152"/>
<rect x="520" y="420" width="140" height="230" rx="60" fill="#3A4152"/>
<rect x="175" y="455" width="70" height="160" rx="35" fill="#6C7894"/>
<rect x="555" y="455" width="70" height="160" rx="35" fill="#6C7894"/>
</svg>`;

export function sampleProductImage(): Promise<Buffer> {
  return sharp(Buffer.from(SAMPLE_PRODUCT_SVG)).png().toBuffer();
}

export async function sampleRenderInput(template: OfferStoryTemplate): Promise<OfferStoryRenderInput> {
  return {
    template,
    headline: 'Fone de ouvido Bluetooth com cancelamento de ruído',
    productImage: await sampleProductImage(),
    price: { fromCents: 29990, toCents: 19990 },
    coupon: { code: 'OFERTA10', discountPercent: 10 },
  };
}
