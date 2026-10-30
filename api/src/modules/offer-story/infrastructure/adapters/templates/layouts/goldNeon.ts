import { box, svgLayer, text } from '../storyPrimitives';
import type { StoryLayoutBuilder } from '../storyLayoutModel';
import { burstBadge, couponTicket, ctaZone, heroArea, priceBlock, productSticker, storyFrame, titleText } from '../storyParts';

/** Preto e amarelo de liquidação: faixas zebradas, bloco amarelo no preço, tipografia pesada. */

const YELLOW = '#FFE500';
const BLACK = '#000000';

/** Fita zebrada diagonal (tipo "cuidado") de ponta a ponta. */
function hazard(y: number, rot: number): string {
  const stripes = Array.from({ length: 34 }, (_, i) => `<path d="M${i * 60 - 60} 0 L${i * 60} 0 L${i * 60 - 30} 70 L${i * 60 - 90} 70 Z" fill="${BLACK}"/>`).join('');
  return `<g transform="translate(540 ${y}) rotate(${rot}) translate(-900 -35)"><rect width="1800" height="70" fill="${YELLOW}"/>${stripes}</g>`;
}

function decor(): string {
  const grid = Array.from({ length: 14 }, (_, i) => `<line x1="${i * 80}" y1="0" x2="${i * 80}" y2="1920" stroke="#FFFFFF" stroke-opacity="0.04" stroke-width="2"/>`).join('');
  return (
    grid +
    '<circle cx="540" cy="860" r="520" fill="#FFE500" opacity="0.10"/>' +
    '<circle cx="540" cy="860" r="380" fill="#FFE500" opacity="0.10"/>' +
    hazard(120, -8) +
    hazard(1830, 6)
  );
}

export const goldNeon: StoryLayoutBuilder = (m) =>
  storyFrame(m, {
    gap: 22,
    background: 'linear-gradient(180deg, #121212 0%, #000000 100%)',
    layers: [svgLayer(decor(), 1080, 1920, { left: 0, top: 0 })],
    content: [
      box(
        { flexDirection: 'column', alignItems: 'center' },
        text({ fontFamily: 'Archivo Black', fontSize: 132, lineHeight: 1, color: YELLOW, letterSpacing: -2 }, 'ACHADINHO'),
        box(
          { alignItems: 'center', marginTop: 10 },
          box({ width: 90, height: 8, backgroundColor: '#FFFFFF', marginRight: 22 }),
          text({ fontFamily: 'Archivo Black', fontSize: 60, lineHeight: 1, color: '#FFFFFF', letterSpacing: 12 }, 'DO DIA'),
          box({ width: 90, height: 8, backgroundColor: '#FFFFFF', marginLeft: 22 }),
        ),
      ),
      heroArea(
        900,
        productSticker(m, { width: 880, radius: 28, border: `10px solid ${YELLOW}`, shadow: '0 30px 50px rgba(0,0,0,0.7)' }),
        burstBadge(m, { size: 250, fill: YELLOW, color: BLACK, stroke: BLACK, rotate: 12, points: 20, font: 'Archivo Black', style: { right: -24, bottom: -40 } }),
      ),
      priceBlock(m, {
        color: BLACK,
        fromColor: '#3A3A3A',
        font: 'Archivo Black',
        weight: 400,
        size: 160,
        leadColor: BLACK,
        style: { backgroundColor: YELLOW, padding: '16px 48px 18px', width: 1080, justifyContent: 'center' },
      }),
      titleText(m, { color: '#FFFFFF', size: 44, weight: 700 }),
      couponTicket(m, { background: BLACK, color: '#FFFFFF', accent: YELLOW, accentText: BLACK }),
      ctaZone({ color: YELLOW, slotColor: YELLOW, big: !m.toLabel }),
    ],
  });
