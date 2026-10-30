import { box, image, svg, svgDataUri, svgLayer, text } from '../storyPrimitives';
import type { StoryLayoutBuilder } from '../storyLayoutModel';
import { burstBadge, couponTicket, ctaZone, heroArea, priceBlock, productSticker, storyFrame, titleText } from '../storyParts';

/** Pastel fresco: manchas orgânicas menta/lilás/pêssego, cantos bem redondos, seta de queda de preço. */

const GREEN = '#0B4D3A';
const MINT = '#3DDC97';
const LILAC = '#B9A6FF';

function blobs(): string {
  return (
    `<path d="M-80 120 C 160 40, 380 160, 330 380 C 290 560, 40 520, -80 640 Z" fill="${LILAC}" opacity="0.55"/>` +
    `<path d="M1160 260 C 920 220, 840 470, 980 600 C 1080 690, 1160 640, 1160 640 Z" fill="#FFC9A8" opacity="0.7"/>` +
    `<path d="M1160 1180 C 900 1160, 820 1460, 1000 1560 C 1100 1610, 1160 1580, 1160 1580 Z" fill="${LILAC}" opacity="0.45"/>` +
    `<path d="M-80 1420 C 140 1380, 260 1620, 120 1780 C 40 1860, -80 1820, -80 1820 Z" fill="${MINT}" opacity="0.45"/>` +
    '<circle cx="860" cy="170" r="16" fill="#FFFFFF"/><circle cx="160" cy="900" r="12" fill="#FFFFFF"/><circle cx="960" cy="1060" r="10" fill="#FFFFFF"/>'
  );
}

/** Círculo com seta para baixo (preço caiu). */
function dropIcon(size: number) {
  const body =
    `<circle cx="60" cy="60" r="56" fill="${GREEN}"/>` +
    `<path d="M60 26 V88 M34 64 L60 90 L86 64" fill="none" stroke="${MINT}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`;
  return image(svgDataUri(svg(body, 120, 120)), size, size);
}

export const freshMint: StoryLayoutBuilder = (m) =>
  storyFrame(m, {
    gap: 22,
    background: 'linear-gradient(170deg, #D9FBEA 0%, #C6F3E0 45%, #E6E0FF 100%)',
    layers: [svgLayer(blobs(), 1080, 1920, { left: 0, top: 0 })],
    content: [
      box(
        { alignItems: 'center' },
        dropIcon(118),
        box(
          { flexDirection: 'column', marginLeft: 24 },
          text({ fontFamily: 'Poppins', fontWeight: 900, fontSize: 124, lineHeight: 0.95, color: GREEN, letterSpacing: -4 }, 'Baixou'),
          text({ fontFamily: 'Caveat Brush', fontSize: 84, lineHeight: 0.9, color: '#7B5CFF', marginLeft: 6 }, 'o preço!'),
        ),
      ),
      heroArea(
        900,
        productSticker(m, { width: 880, radius: 72, shadow: '0 30px 50px rgba(11,77,58,0.22)', placeholderColor: '#BFE9D6' }),
        burstBadge(m, { size: 230, fill: '#7B5CFF', color: '#FFFFFF', rotate: -10, points: 24, style: { left: -20, top: -30 } }),
      ),
      priceBlock(m, { color: GREEN, fromColor: '#4F7F6E', size: 176, leadColor: '#7B5CFF' }),
      titleText(m, { color: GREEN, size: 44, weight: 700 }),
      couponTicket(m, { background: '#FFFFFF', color: GREEN, accent: MINT, accentText: GREEN }),
      ctaZone({ color: GREEN, slotColor: '#2BB37A', big: !m.toLabel }),
    ],
  });
