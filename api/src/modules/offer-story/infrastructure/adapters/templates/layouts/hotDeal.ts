import { box, svgLayer, text } from '../storyPrimitives';
import type { StoryLayoutBuilder } from '../storyLayoutModel';
import { burstBadge, couponTicket, ctaZone, heroArea, priceBlock, productSticker, storyFrame, titleText } from '../storyParts';

/** Fogo: chamas em camadas subindo da base, brasas, chamada inclinada com sombra dura vinho. */

const WINE = '#5C0700';
const FLAME = '#FFE14D';

/** Linha de chamas (picos alternados) de largura total; `base` = y onde as chamas nascem. */
function flames(base: number, height: number, fill: string, seed: number): string {
  const n = 9;
  const w = 1080 / n;
  let d = `M0 1920 L0 ${base}`;
  for (let i = 0; i < n; i += 1) {
    const x = i * w;
    const peak = base - height * (0.6 + (((i + seed) * 47) % 40) / 100);
    d += ` C ${x + w * 0.1} ${base - height * 0.3}, ${x + w * 0.2} ${peak + 60}, ${x + w * 0.45} ${peak}`;
    d += ` C ${x + w * 0.55} ${peak + 90}, ${x + w * 0.9} ${base - height * 0.2}, ${x + w} ${base}`;
  }
  return `<path d="${d} L1080 1920 Z" fill="${fill}"/>`;
}

function decor(): string {
  const embers = [
    [120, 300, 6], [930, 380, 5], [210, 780, 4], [1000, 900, 7], [70, 1120, 5], [880, 1260, 4], [520, 160, 4], [760, 120, 6],
  ].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${FLAME}" opacity="0.8"/>`);
  return (
    '<defs><radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFB000" stop-opacity="0.6"/><stop offset="1" stop-color="#FFB000" stop-opacity="0"/></radialGradient></defs>' +
    '<ellipse cx="540" cy="860" rx="620" ry="560" fill="url(#glow)"/>' +
    flames(1790, 300, '#B81400', 1) +
    flames(1840, 220, '#FF5A00', 4) +
    flames(1890, 150, '#FFB000', 7) +
    embers.join('')
  );
}

export const hotDeal: StoryLayoutBuilder = (m) =>
  storyFrame(m, {
    gap: 22,
    background: 'linear-gradient(180deg, #2A0400 0%, #8A0F00 45%, #E23A00 100%)',
    layers: [svgLayer(decor(), 1080, 1920, { left: 0, top: 0 })],
    content: [
      box(
        { alignItems: 'flex-end', transform: 'rotate(-4deg)' },
        text({ fontFamily: 'Anton', fontSize: 140, lineHeight: 1, color: '#FFFFFF', textShadow: `7px 7px 0 ${WINE}` }, 'OFERTA'),
        text({ fontFamily: 'Anton', fontSize: 140, lineHeight: 1, color: FLAME, textShadow: `7px 7px 0 ${WINE}`, marginLeft: 22 }, 'QUENTE'),
      ),
      heroArea(
        900,
        productSticker(m, { width: 860, radius: 48, rotate: 2, border: `8px solid ${FLAME}`, shadow: '0 0 40px rgba(255,176,0,0.75)' }),
        burstBadge(m, { size: 250, fill: FLAME, color: '#C21500', stroke: WINE, rotate: -14, points: 12, style: { left: -30, top: -40 } }),
      ),
      priceBlock(m, {
        color: FLAME,
        fromColor: '#FFD9C2',
        font: 'Anton',
        weight: 400,
        size: 190,
        shadow: `7px 7px 0 ${WINE}`,
        leadColor: '#FFFFFF',
      }),
      titleText(m, { color: '#FFFFFF', size: 44, style: { textShadow: `2px 3px 0 ${WINE}` } }),
      couponTicket(m, { background: WINE, color: '#FFFFFF', accent: FLAME, accentText: WINE, rotate: -1 }),
      ctaZone({ color: '#FFFFFF', slotColor: '#FFFFFF', big: !m.toLabel }),
    ],
  });
