import { box, svgLayer, text } from '../storyPrimitives';
import type { StoryLayoutBuilder } from '../storyLayoutModel';
import { couponTicket, ctaZone, heroArea, priceBlock, productSticker, storyFrame, titleText } from '../storyParts';

/**
 * Editorial premium: fundo branco (a foto do produto se funde nele, sem moldura), serifa de
 * revista, preto + um único acento vermelho no desconto.
 */

const INK = '#141414';
const RED = '#E8202A';

function decor(): string {
  return (
    `<rect x="36" y="36" width="1008" height="1848" fill="none" stroke="${INK}" stroke-width="3"/>`
  );
}

/** Selo redondo vermelho "-72%" (só com preço "De"). */
function offSeal(off: number | null) {
  if (off === null) return null;
  return box(
    {
      position: 'absolute',
      right: 0,
      top: 10,
      width: 210,
      height: 210,
      borderRadius: 105,
      backgroundColor: RED,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      transform: 'rotate(8deg)',
    },
    text({ fontFamily: 'DM Serif Display', fontSize: 84, lineHeight: 1, color: '#FFFFFF' }, `-${off}%`),
    text({ fontFamily: 'Poppins', fontWeight: 700, fontSize: 22, letterSpacing: 4, color: '#FFFFFF', marginTop: 2 }, 'DESCONTO'),
  );
}

export const cleanLight: StoryLayoutBuilder = (m) =>
  storyFrame(m, {
    gap: 22,
    background: 'linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 70%, #F1F1F1 100%)',
    layers: [svgLayer(decor(), 1080, 1920, { left: 0, top: 0 })],
    content: [
      box(
        { flexDirection: 'column', alignItems: 'flex-start', width: 920 },
        text({ fontFamily: 'DM Serif Display', fontSize: 126, lineHeight: 0.95, color: INK, letterSpacing: -3 }, 'Vale cada'),
        box(
          { alignItems: 'flex-end' },
          text({ fontFamily: 'DM Serif Display', fontStyle: 'italic', fontSize: 126, lineHeight: 1, color: INK, letterSpacing: -3 }, 'centavo.'),
          box({ flexGrow: 1, height: 3, backgroundColor: INK, marginLeft: 28, marginBottom: 30, width: 300 }),
        ),
      ),
      heroArea(
        920,
        productSticker(m, { width: 920, radius: 0, padding: 10, background: '#FFFFFF', placeholderColor: '#DADADA' }),
        offSeal(m.offPercent),
      ),
      titleText(m, { color: INK, size: 44, weight: 700, width: 920, align: 'left' }),
      priceBlock(m, {
        color: '#FFFFFF',
        fromColor: '#BDBDBD',
        size: 160,
        leadFont: 'DM Serif Display',
        leadColor: '#FFFFFF',
        style: { backgroundColor: INK, padding: '18px 44px 20px', width: 920, justifyContent: 'flex-start' },
        fromStyle: { textDecorationColor: RED },
      }),
      couponTicket(m, { background: '#FFFFFF', color: INK, accent: INK, accentText: '#FFFFFF', style: { alignSelf: 'flex-start', marginLeft: 80 } }),
      ctaZone({ color: INK, slotColor: '#9A9A9A', font: 'DM Serif Display', size: 54, label: 'toque no link', big: !m.toLabel, style: m.toLabel ? { alignSelf: 'flex-start', marginLeft: 80 } : {} }),
    ],
  });
