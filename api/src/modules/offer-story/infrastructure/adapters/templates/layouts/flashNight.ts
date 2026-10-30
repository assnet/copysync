import { box, svgLayer, text, image, svgDataUri, svg } from '../storyPrimitives';
import type { StoryLayoutBuilder } from '../storyLayoutModel';
import { burstBadge, couponTicket, ctaZone, heroArea, priceBlock, productSticker, storyFrame, titleText } from '../storyParts';

/** Noite neon: grade synthwave, raio amarelo e contorno ciano em volta da foto. */

const CYAN = '#2EF2FF';
const PINK = '#FF2BD6';
const YELLOW = '#FFE600';
const INK = '#0B0322';

/** Grade em perspectiva (chão synthwave) na base e estrelas no céu. */
function nightDecor(): string {
  const horizon = 1380;
  const rows = [0, 18, 44, 80, 128, 190, 268, 366, 490].map(
    (dy, i) => `<line x1="0" y1="${horizon + dy}" x2="1080" y2="${horizon + dy}" stroke="${PINK}" stroke-width="${2 + i * 0.6}" opacity="${0.18 + i * 0.05}"/>`,
  );
  const cols = Array.from({ length: 21 }, (_, i) => {
    const xTop = 540 + (i - 10) * 60;
    const xBottom = 540 + (i - 10) * 260;
    return `<line x1="${xTop}" y1="${horizon}" x2="${xBottom}" y2="1920" stroke="${PINK}" stroke-width="3" opacity="0.32"/>`;
  });
  const stars = [
    [80, 120, 3], [220, 300, 2], [960, 140, 3], [1010, 420, 2], [60, 640, 2], [880, 260, 2],
    [400, 90, 2], [700, 160, 3], [1040, 820, 2], [30, 980, 3], [140, 1220, 2], [990, 1180, 2],
  ].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#FFFFFF" opacity="0.8"/>`);
  return (
    `<defs><radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${PINK}" stop-opacity="0.55"/><stop offset="1" stop-color="${PINK}" stop-opacity="0"/></radialGradient></defs>` +
    `<ellipse cx="540" cy="${horizon}" rx="760" ry="260" fill="url(#sun)"/>` +
    rows.join('') +
    cols.join('') +
    stars.join('')
  );
}

const BOLT = 'M118 0 L18 176 L84 176 L40 320 L176 120 L108 120 L160 0 Z';

function bolt(w: number): ReturnType<typeof image> {
  const body =
    `<path d="${BOLT}" fill="${YELLOW}" stroke="#FFFFFF" stroke-width="6" stroke-linejoin="round"/>`;
  return image(svgDataUri(svg(body, 180, 320)), w, Math.round((w * 320) / 180));
}

const neon = (color: string) => `0 0 8px ${color}, 0 0 26px ${color}, 0 0 48px ${color}`;

export const flashNight: StoryLayoutBuilder = (m) => {
  return storyFrame(m, {
    gap: 22,
    background: `radial-gradient(circle at 50% 30%, #2A0A6B 0%, #12043A 45%, ${INK} 100%)`,
    layers: [
      svgLayer(nightDecor(), 1080, 1920, { left: 0, top: 0 }),
    ],
    content: [
      box(
        { alignItems: 'center' },
        bolt(96),
        box(
          { flexDirection: 'column', marginLeft: 26 },
          text({ fontFamily: 'Anton', fontSize: 128, lineHeight: 1, color: '#FFFFFF', letterSpacing: 6, textShadow: neon(CYAN) }, 'OFERTA'),
          text({ fontFamily: 'Anton', fontSize: 76, lineHeight: 1, color: YELLOW, letterSpacing: 13, textShadow: neon('#FF9D00') }, 'RELÂMPAGO'),
        ),
      ),
      heroArea(
        900,
        productSticker(m, {
          width: 860,
          radius: 60,
          rotate: -2,
          border: `6px solid ${CYAN}`,
          shadow: `0 0 24px ${CYAN}, 0 0 50px rgba(46,242,255,0.55)`,
        }),
        burstBadge(m, { size: 250, fill: YELLOW, color: INK, rotate: 14, style: { right: -30, top: -50 } }),
      ),
      priceBlock(m, {
        color: '#FFFFFF',
        fromColor: '#C8B8FF',
        size: 170,
        shadow: neon(PINK),
        lead: 'por',
        leadColor: CYAN,
        style: {
          backgroundColor: INK,
          padding: '14px 44px 18px',
          borderRadius: 40,
          border: `5px solid ${PINK}`,
          boxShadow: `0 0 30px ${PINK}, 0 16px 40px rgba(0,0,0,0.6)`,
        },
      }),
      titleText(m, { color: '#FFFFFF', size: 44, style: { opacity: 0.95 } }),
      couponTicket(m, { background: 'rgba(255,255,255,0.08)', color: '#FFFFFF', accent: PINK, accentText: '#FFFFFF' }),
      ctaZone({ color: CYAN, slotColor: CYAN, big: !m.toLabel }),
    ],
  });
};
