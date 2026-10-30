import { box, svgLayer, text } from '../storyPrimitives';
import type { StoryLayoutBuilder } from '../storyLayoutModel';
import { burstBadge, couponTicket, ctaZone, heroArea, priceBlock, productSticker, storyFrame, titleText } from '../storyParts';

/** Colagem "achadinhos": xadrez rosa, polaroid com fitas adesivas, corações e letra cursiva. */

const HOT = '#FF2E88';
const DEEP = '#7A0E46';

function heart(x: number, y: number, s: number, fill: string, rot: number): string {
  return `<path transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" d="M0 12 C -12 -6, -34 4, -22 22 L0 44 L22 22 C 34 4, 12 -6, 0 12 Z" fill="${fill}"/>`;
}

/** Confete geométrico: círculo, anel ou traço curto. */
function confetti(x: number, y: number, kind: number, fill: string): string {
  if (kind === 0) return `<circle cx="${x}" cy="${y}" r="14" fill="${fill}"/>`;
  if (kind === 1) return `<circle cx="${x}" cy="${y}" r="16" fill="none" stroke="${fill}" stroke-width="7"/>`;
  return `<rect x="${x - 24}" y="${y - 6}" width="48" height="12" rx="6" fill="${fill}" transform="rotate(${(x * 7) % 90 - 45} ${x} ${y})"/>`;
}

function gingham(): string {
  return (
    '<defs><pattern id="g" width="90" height="90" patternUnits="userSpaceOnUse">' +
    '<rect width="90" height="90" fill="#FFD3E5"/><rect width="45" height="90" fill="#FFB8D6" opacity="0.55"/><rect width="90" height="45" fill="#FFB8D6" opacity="0.55"/>' +
    '</pattern></defs><rect width="1080" height="1920" fill="url(#g)"/>' +
    heart(90, 330, 2.2, HOT, -18) +
    heart(990, 260, 1.5, '#FFFFFF', 16) +
    heart(1010, 1330, 2.4, HOT, 20) +
    heart(60, 1500, 1.4, '#FFFFFF', -10) +
    [[200, 150, 0], [880, 120, 2], [960, 560, 1], [60, 980, 2], [1030, 1000, 0], [1020, 1700, 1], [80, 1780, 0], [150, 760, 1]]
      .map(([x, y, k], i) => confetti(x, y, k, i % 2 ? '#FFFFFF' : HOT))
      .join('')
  );
}

/** Fita adesiva semitransparente (por cima da polaroid). */
function tape(left: number, top: number, rot: number): ReturnType<typeof svgLayer> {
  return svgLayer(
    '<rect width="220" height="64" fill="#FFF6B8" opacity="0.85"/><path d="M0 0 L8 10 L0 20 L8 32 L0 44 L8 54 L0 64 M220 0 L212 10 L220 20 L212 32 L220 44 L212 54 L220 64" stroke="#F6E68A" stroke-width="3" fill="none"/>',
    220,
    64,
    { left, top, transform: `rotate(${rot}deg)` },
  );
}

export const pinkWeek: StoryLayoutBuilder = (m) =>
  storyFrame(m, {
    gap: 20,
    background: 'linear-gradient(180deg, #FFD3E5 0%, #FFC2DC 100%)',
    layers: [svgLayer(gingham(), 1080, 1920, { left: 0, top: 0 })],
    content: [
      box(
        { flexDirection: 'column', alignItems: 'center' },
        text({ fontFamily: 'Pacifico', fontSize: 118, lineHeight: 1.15, color: HOT, textShadow: '5px 5px 0 #FFFFFF' }, 'Promoção'),
        text(
          {
            fontFamily: 'Poppins',
            fontWeight: 900,
            fontSize: 58,
            lineHeight: 1,
            color: '#FFFFFF',
            backgroundColor: DEEP,
            padding: '12px 34px 14px',
            borderRadius: 999,
            letterSpacing: 4,
            transform: 'rotate(-3deg)',
            marginTop: 6,
          },
          'DA SEMANA',
        ),
      ),
      heroArea(
        920,
        box(
          {
            flexGrow: 1,
            flexShrink: 1,
            flexBasis: 0,
            minHeight: 0,
            flexDirection: 'column',
            alignItems: 'center',
            backgroundColor: '#FFFFFF',
            padding: '28px 28px 22px',
            borderRadius: 14,
            transform: 'rotate(-2.5deg)',
            boxShadow: '0 22px 40px rgba(122,14,70,0.28)',
          },
          productSticker(m, { width: 800, radius: 8, padding: 24, background: '#FFFFFF', placeholderColor: '#FFB8D6' }),
          titleText(m, { color: DEEP, size: 42, width: 780, style: { marginTop: 14 } }),
        ),
        tape(40, -6, -30),
        tape(680, -14, 26),
        burstBadge(m, { size: 230, fill: '#FFE45C', color: HOT, rotate: 10, points: 22, style: { right: -10, top: 120 } }),
      ),
      priceBlock(m, {
        color: '#FFFFFF',
        fromColor: '#FFE1EE',
        size: 160,
        leadColor: '#FFE45C',
        style: {
          backgroundColor: HOT,
          padding: '12px 44px 14px',
          borderRadius: 999,
          border: '8px solid #FFFFFF',
          boxShadow: '0 14px 30px rgba(122,14,70,0.3)',
          transform: 'rotate(2deg)',
          marginTop: -8,
        },
      }),
      couponTicket(m, { background: '#FFFFFF', color: DEEP, accent: HOT, accentText: '#FFFFFF', rotate: -1.5 }),
      ctaZone({ color: DEEP, slotColor: HOT, big: !m.toLabel }),
    ],
  });
