import { box, image, svg, svgDataUri, svgLayer, text } from '../storyPrimitives';
import type { StoryLayoutBuilder } from '../storyLayoutModel';
import { burstBadge, couponTicket, ctaZone, heroArea, priceBlock, productSticker, storyFrame, titleText } from '../storyParts';

/** Pop-art de gibi: retícula, raios, contorno preto grosso e sombra dura deslocada. */

const BLUE = '#1E4BFF';
const YELLOW = '#FFD400';
const RED = '#FF2D55';
const INK = '#0A0F2E';

function comicDecor(): string {
  const rays = Array.from({ length: 24 }, (_, i) => {
    const a = (i * 15 * Math.PI) / 180;
    const b = ((i * 15 + 7) * Math.PI) / 180;
    const [cx, cy, r] = [540, 860, 1600];
    return `<path d="M${cx} ${cy} L${(cx + r * Math.cos(a)).toFixed(0)} ${(cy + r * Math.sin(a)).toFixed(0)} L${(cx + r * Math.cos(b)).toFixed(0)} ${(cy + r * Math.sin(b)).toFixed(0)} Z" fill="#FFFFFF" opacity="0.09"/>`;
  }).join('');
  const dots =
    '<defs><pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="13" cy="13" r="5" fill="#0A0F2E" opacity="0.28"/></pattern>' +
    '<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
    '<mask id="m"><rect width="1080" height="700" fill="url(#fade)"/></mask></defs>';
  return (
    dots +
    rays +
    '<rect width="1080" height="700" fill="url(#dots)" mask="url(#m)"/>' +
    '<g transform="translate(0 1220) scale(1 -1) translate(0 -700)"><rect y="0" width="1080" height="700" fill="url(#dots)" mask="url(#m)" opacity="0.7"/></g>'
  );
}

/** Estouro amarelo serrilhado atrás da foto. */
function explosion(): string {
  const pts = Array.from({ length: 28 }, (_, i) => {
    const a = (i * Math.PI) / 14;
    const r = i % 2 === 0 ? 530 : 430 + ((i * 37) % 50);
    return `${(540 + r * Math.cos(a)).toFixed(0)} ${(480 + r * 0.92 * Math.sin(a)).toFixed(0)}`;
  });
  return `<path d="M${pts.join(' L')} Z" fill="${YELLOW}" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>`;
}

const outline = (w: number, c: string) =>
  `${w}px ${w}px 0 ${c}, -${w / 2}px -${w / 2}px 0 ${c}, ${w / 2}px -${w / 2}px 0 ${c}, -${w / 2}px ${w / 2}px 0 ${c}`;

export const blueBurst: StoryLayoutBuilder = (m) =>
  storyFrame(m, {
    gap: 22,
    background: `radial-gradient(circle at 50% 45%, #3D6BFF 0%, ${BLUE} 55%, #0F2FB8 100%)`,
    layers: [svgLayer(comicDecor(), 1080, 1920, { left: 0, top: 0 })],
    content: [
      box(
        { flexDirection: 'column', alignItems: 'center', transform: 'rotate(-3deg)' },
        text(
          {
            fontFamily: 'Archivo Black',
            fontSize: 70,
            lineHeight: 1,
            color: INK,
            backgroundColor: YELLOW,
            padding: '8px 26px 12px',
            border: `6px solid ${INK}`,
            borderRadius: 16,
            letterSpacing: 6,
            marginBottom: -6,
          },
          'SUPER',
        ),
        text(
          { fontFamily: 'Archivo Black', fontSize: 150, lineHeight: 1.05, color: '#FFFFFF', textShadow: `${outline(8, INK)}, 14px 14px 0 ${RED}` },
          'OFERTA!',
        ),
      ),
      heroArea(
        900,
        // Estouro atrás da foto, esticado na altura que a foto ganhar (sem invadir a chamada).
        box(
          { position: 'absolute', left: -90, right: -90, top: 10, bottom: -10 },
          image(svgDataUri(svg(explosion(), 1080, 960).replace('<svg ', '<svg preserveAspectRatio="none" ')), 1080, 960, { width: '100%', height: '100%' }),
        ),
        productSticker(m, {
          width: 820,
          radius: 40,
          rotate: 2,
          border: `8px solid ${INK}`,
          shadow: `18px 18px 0 ${INK}`,
        }),
        burstBadge(m, { size: 250, fill: RED, color: '#FFFFFF', stroke: INK, rotate: -12, points: 14, font: 'Archivo Black', style: { left: -10, top: -30 } }),
      ),
      priceBlock(m, {
        color: INK,
        fromColor: INK,
        font: 'Archivo Black',
        weight: 400,
        size: 150,
        leadColor: RED,
        style: {
          backgroundColor: YELLOW,
          padding: '14px 40px 16px',
          border: `7px solid ${INK}`,
          borderRadius: 26,
          boxShadow: `12px 12px 0 ${INK}`,
          transform: 'rotate(-2deg)',
        },
      }),
      titleText(m, { color: '#FFFFFF', size: 44, style: { textShadow: `3px 3px 0 ${INK}` } }),
      couponTicket(m, { background: '#FFFFFF', color: INK, accent: INK, accentText: YELLOW, rotate: 1 }),
      ctaZone({ color: '#FFFFFF', slotColor: '#FFFFFF', big: !m.toLabel }),
    ],
  });
