import { box, svgLayer, text } from '../storyPrimitives';
import type { StoryLayoutBuilder } from '../storyLayoutModel';
import { burstBadge, couponTicket, ctaZone, heroArea, priceBlock, productSticker, storyFrame, titleText } from '../storyParts';

/** Y2K: malha de gradiente violeta/rosa/ciano, letreiro cromado, brilhos de quatro pontas, borda iridescente. */

const VIOLET = '#5B16D9';
const LIME = '#D4FF3A';
const DEEP = '#22064F';

/** Formas Y2K: anel, triângulo, rabisco em zigue-zague e pílula. */
function shape(x: number, y: number, kind: number, fill: string): string {
  if (kind === 0) return `<circle cx="${x}" cy="${y}" r="30" fill="none" stroke="${fill}" stroke-width="10"/>`;
  if (kind === 1) return `<path d="M${x} ${y - 34} L${x + 32} ${y + 22} L${x - 32} ${y + 22} Z" fill="${fill}" transform="rotate(${x % 50} ${x} ${y})"/>`;
  if (kind === 2) return `<path d="M${x - 60} ${y} l20 -20 l20 20 l20 -20 l20 20 l20 -20 l20 20" fill="none" stroke="${fill}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<rect x="${x - 44}" y="${y - 16}" width="88" height="32" rx="16" fill="${fill}" transform="rotate(-30 ${x} ${y})"/>`;
}

function decor(): string {
  return (
    '<defs><pattern id="d" width="36" height="36" patternUnits="userSpaceOnUse"><circle cx="18" cy="18" r="2.4" fill="#FFFFFF" opacity="0.18"/></pattern></defs>' +
    '<rect width="1080" height="1920" fill="url(#d)"/>' +
    `<circle cx="540" cy="900" r="500" fill="none" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="3"/>` +
    `<circle cx="540" cy="900" r="600" fill="none" stroke="#FFFFFF" stroke-opacity="0.10" stroke-width="3"/>` +
    [[150, 120, 2], [960, 150, 0], [1040, 640, 1], [40, 1000, 3], [1030, 1330, 2], [50, 1450, 0], [700, 90, 3]]
      .map(([x, y, k], i) => shape(x, y, k, i % 2 ? LIME : '#FFFFFF'))
      .join('')
  );
}

const CHROME = 'linear-gradient(180deg, #FFFFFF 0%, #F2E9FF 38%, #9C8CC9 52%, #FFFFFF 64%, #E7DBFF 100%)';

export const newsViolet: StoryLayoutBuilder = (m) =>
  storyFrame(m, {
    gap: 22,
    background:
      'radial-gradient(circle at 15% 12%, #FF5FD2 0%, rgba(255,95,210,0) 45%), radial-gradient(circle at 90% 40%, #2FD8FF 0%, rgba(47,216,255,0) 40%), radial-gradient(circle at 20% 85%, #8A3DFF 0%, rgba(138,61,255,0) 50%), linear-gradient(170deg, #3A0CA3 0%, #5B16D9 50%, #2A0878 100%)',
    layers: [svgLayer(decor(), 1080, 1920, { left: 0, top: 0 })],
    content: [
      box(
        { flexDirection: 'column', alignItems: 'center' },
        text(
          {
            fontFamily: 'Archivo Black',
            fontSize: 150,
            lineHeight: 1.05,
            letterSpacing: -2,
            backgroundImage: CHROME,
            backgroundClip: 'text',
            color: 'transparent',
            filter: `drop-shadow(0 6px 0 ${DEEP})`,
          },
          'NOVIDADE',
        ),
        text(
          {
            fontFamily: 'Poppins',
            fontWeight: 700,
            fontSize: 40,
            lineHeight: 1,
            color: DEEP,
            backgroundColor: LIME,
            padding: '12px 30px 14px',
            borderRadius: 999,
            marginTop: 6,
          },
          'acabou de chegar',
        ),
      ),
      heroArea(
        900,
        box(
          {
            flexGrow: 1,
            flexShrink: 1,
            flexBasis: 0,
            minHeight: 0,
            flexDirection: 'column',
            padding: 10,
            borderRadius: 66,
            backgroundImage: 'linear-gradient(135deg, #FF5FD2 0%, #FFE07A 30%, #2FD8FF 62%, #B78CFF 100%)',
            boxShadow: '0 26px 50px rgba(34,6,79,0.55)',
          },
          productSticker(m, { width: 860, radius: 56, placeholderColor: '#D9CCF5' }),
        ),
        burstBadge(m, { size: 240, fill: LIME, color: DEEP, rotate: 12, points: 12, style: { right: -40, top: -50 } }),
      ),
      priceBlock(m, { color: '#FFFFFF', fromColor: '#E3D6FF', size: 176, shadow: `0 6px 0 ${DEEP}`, leadColor: LIME }),
      titleText(m, { color: '#FFFFFF', size: 44 }),
      couponTicket(m, { background: 'rgba(255,255,255,0.14)', color: '#FFFFFF', accent: LIME, accentText: DEEP }),
      ctaZone({ color: LIME, slotColor: '#FFFFFF', big: !m.toLabel }),
    ],
  });
