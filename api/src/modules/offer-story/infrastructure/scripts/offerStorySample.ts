import sharp from 'sharp';
import type { OfferStoryRenderInput } from '../../domain/contracts/IOfferStoryRenderer';
import type { OfferStoryTemplate } from '../../domain/offerStoryTemplates';

/** Foto genérica (fone desenhado em SVG) para thumbnails e testes; nenhum produto real. */
const SAMPLE_PRODUCT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
<defs>
<linearGradient id="band" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF7A59"/><stop offset="1" stop-color="#E2335B"/></linearGradient>
<linearGradient id="cup" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF8A66"/><stop offset="1" stop-color="#C92A50"/></linearGradient>
<radialGradient id="floor" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.18"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
</defs>
<rect width="800" height="800" fill="#FFFFFF"/>
<ellipse cx="400" cy="700" rx="300" ry="40" fill="url(#floor)"/>
<path d="M190 470 C 180 200, 620 200, 610 470" fill="none" stroke="url(#band)" stroke-width="56" stroke-linecap="round"/>
<path d="M215 440 C 215 250, 585 250, 585 440" fill="none" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="10" stroke-linecap="round"/>
<rect x="120" y="410" width="170" height="270" rx="80" fill="url(#cup)"/>
<rect x="510" y="410" width="170" height="270" rx="80" fill="url(#cup)"/>
<rect x="250" y="450" width="56" height="190" rx="28" fill="#2B2F3A"/>
<rect x="494" y="450" width="56" height="190" rx="28" fill="#2B2F3A"/>
<rect x="150" y="440" width="34" height="150" rx="17" fill="#FFFFFF" fill-opacity="0.35"/>
<rect x="540" y="440" width="34" height="150" rx="17" fill="#FFFFFF" fill-opacity="0.35"/>
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
