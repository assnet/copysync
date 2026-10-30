import { storyCard, type StoryCardTheme } from './storyCard';
import { box, image, svgDataUri, text, type StoryNode, type StoryStyle } from './storyPrimitives';
import type { StoryLayoutBuilder, StoryLayoutModel } from './storyLayoutModel';

/**
 * Um layout por id de `OFFER_STORY_TEMPLATES`. Todos seguem a mesma grade: zona de chamada no
 * topo (abaixo da barra do Instagram), card do produto centralizado no restante, margem de
 * baixo livre para a barra de resposta. Muda só fundo, decoração, chamada e cores do card.
 */

const W = 1080;
const H = 1920;

interface FrameParts {
  background: string;
  /** Corpo SVG (1080×1920) desenhado sobre o fundo e atrás do conteúdo. */
  decor: string;
  headline: StoryNode;
  card: StoryCardTheme;
}

function frame(model: StoryLayoutModel, parts: FrameParts): StoryNode {
  return box(
    {
      width: model.width,
      height: model.height,
      flexDirection: 'column',
      alignItems: 'center',
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: '#000000',
      backgroundImage: parts.decor ? `url(${svgDataUri(svg(parts.decor))}), ${parts.background}` : parts.background,
      backgroundSize: `${W}px ${H}px, 100% 100%`,
      backgroundRepeat: 'no-repeat',
    },
    box(
      { width: W, height: 600, paddingTop: 170, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
      parts.headline,
    ),
    box(
      { width: W, flexGrow: 1, paddingBottom: 150, alignItems: 'center', justifyContent: 'center' },
      storyCard(model, parts.card),
    ),
  );
}

const anton = (size: number, color: string, extra: StoryStyle = {}): StoryStyle => ({
  fontFamily: 'Anton',
  fontSize: size,
  lineHeight: 1,
  color,
  ...extra,
});
const script = (size: number, color: string, extra: StoryStyle = {}): StoryStyle => ({
  fontFamily: 'Pacifico',
  fontSize: size,
  lineHeight: 1.25,
  color,
  ...extra,
});
const column = (...children: StoryNode[]) => box({ flexDirection: 'column', alignItems: 'center' }, ...children);
const svg = (body: string, w = W, h = H) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

const LIGHTNING_BOLT = '<path d="M110 0 L10 170 L75 170 L30 300 L165 115 L100 115 L150 0 Z" fill="#FFD60A"/>';

/** Noite azul-marinho com raio amarelo: urgência de oferta relâmpago. */
const flashNight: StoryLayoutBuilder = (m) =>
  frame(m, {
    background: 'linear-gradient(180deg, #0A0E3C 0%, #1C1366 100%)',
    decor:
      '<path d="M1000 1260 L930 1420 L980 1420 L925 1560 L1060 1380 L1005 1380 L1050 1260 Z" fill="#FFD60A" opacity="0.18"/>' +
            [
              [70, 520, 6],
              [300, 90, 5],
              [560, 140, 4],
              [980, 900, 6],
              [40, 1500, 5],
              [1030, 1700, 4],
              [620, 40, 3],
            ]
              .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#FFFFFF" opacity="0.7"/>`)
              .join(''),
    headline: box(
      { alignItems: 'center' },
      image(svgDataUri(svg(LIGHTNING_BOLT, 170, 300)), 170, 300, { marginRight: 28 }),
      box(
        { flexDirection: 'column', alignItems: 'flex-start' },
        text(anton(210, '#FFD60A', { letterSpacing: 4 }), 'OFERTA'),
        text(anton(112, '#FFFFFF', { letterSpacing: 8, marginTop: 4 }), 'RELÂMPAGO'),
      ),
    ),
    card: {
      priceColor: '#1C1366',
      couponBg: '#FFD60A',
      couponText: '#0A0E3C',
      discountBg: '#0A0E3C',
      discountText: '#FFD60A',
      imageBg: '#F2F3F8',
    },
  });

/** Raios de luz a partir do centro da chamada sobre azul royal. */
const blueBurst: StoryLayoutBuilder = (m) => {
  const rays = Array.from({ length: 18 }, (_, i) => {
    const a = (i * 20 * Math.PI) / 180;
    const b = ((i * 20 + 9) * Math.PI) / 180;
    const cx = 540;
    const cy = 420;
    const r = 1500;
    return `<path d="M${cx} ${cy} L${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)} L${cx + r * Math.cos(b)} ${cy + r * Math.sin(b)} Z" fill="#FFFFFF" opacity="0.07"/>`;
  }).join('');
  return frame(m, {
    background: 'radial-gradient(circle at 50% 22%, #3D7BFF 0%, #1746E0 45%, #0A267F 100%)',
    decor:
      rays,
    headline: column(
      text(anton(120, '#FFFFFF', { letterSpacing: 18 }), 'SUPER'),
      text(anton(250, '#FFFFFF', { textShadow: '10px 10px 0 #FFC400', marginTop: -4 }), 'OFERTA'),
    ),
    card: {
      priceColor: '#1746E0',
      couponBg: '#FFC400',
      couponText: '#0A267F',
      discountBg: '#0A267F',
      discountText: '#FFFFFF',
      imageBg: '#EEF3FF',
    },
  });
};

/** Rosa vibrante com bolhas e faixa inclinada: promoção da semana. */
const pinkWeek: StoryLayoutBuilder = (m) =>
  frame(m, {
    background: 'linear-gradient(160deg, #FF3D8B 0%, #FF6FAE 55%, #FF9CC8 100%)',
    decor:
      '<circle cx="980" cy="160" r="230" fill="#FFFFFF" opacity="0.16"/>' +
            '<circle cx="60" cy="560" r="150" fill="#FFFFFF" opacity="0.14"/>' +
            '<circle cx="1000" cy="1500" r="260" fill="#FFFFFF" opacity="0.12"/>' +
            '<circle cx="90" cy="1820" r="200" fill="#7A0F45" opacity="0.12"/>',
    headline: column(
      text(script(150, '#FFFFFF', { textShadow: '0 6px 0 rgba(122,15,69,0.35)' }), 'Promoção'),
      box(
        { marginTop: 18, padding: '14px 44px', backgroundColor: '#FFFFFF', borderRadius: 18, transform: 'rotate(-3deg)' },
        text(anton(104, '#E0136E', { letterSpacing: 6 }), 'DA SEMANA'),
      ),
    ),
    card: {
      priceColor: '#D10F65',
      couponBg: '#4A0B2E',
      couponText: '#FFFFFF',
      discountBg: '#FF3D8B',
      discountText: '#FFFFFF',
      imageBg: '#FFF0F6',
    },
  });

/** Preto com moldura neon dourada: achadinho do dia. */
const goldNeon: StoryLayoutBuilder = (m) =>
  frame(m, {
    background: 'radial-gradient(circle at 50% 18%, #2A2008 0%, #0A0804 55%, #000000 100%)',
    decor:
      '<rect x="22" y="22" width="1036" height="1876" rx="60" fill="none" stroke="#FFC83D" stroke-width="5" opacity="0.85"/>',
    headline: column(
      text(
        anton(196, '#FFD25E', { letterSpacing: 6, textShadow: '0 0 28px rgba(255,200,61,0.75)' }),
        'ACHADINHO',
      ),
      text(script(92, '#FFFFFF', { marginTop: -6, textShadow: '0 0 18px rgba(255,255,255,0.5)' }), 'do dia'),
    ),
    card: {
      priceColor: '#111111',
      couponBg: '#111111',
      couponText: '#FFD25E',
      discountBg: '#FFD25E',
      discountText: '#111111',
      imageBg: '#F6F3EA',
      cardStyle: { border: '6px solid #FFC83D', boxShadow: '0 0 50px rgba(255,200,61,0.45)' },
    },
  });

/** Menta clara com folhas orgânicas e verde profundo: preço que baixou. */
const freshMint: StoryLayoutBuilder = (m) =>
  frame(m, {
    background: 'linear-gradient(180deg, #C8F3DF 0%, #A6EBCB 100%)',
    decor:
      '<path d="M-60 300 C 120 120, 340 220, 300 420 C 260 600, 40 560, -60 700 Z" fill="#0B5D43" opacity="0.12"/>' +
            '<path d="M1140 80 C 920 40, 820 260, 960 380 C 1080 480, 1140 420, 1140 420 Z" fill="#12A372" opacity="0.25"/>' +
            '<path d="M1140 1400 C 940 1440, 900 1700, 1140 1820 Z" fill="#0B5D43" opacity="0.12"/>' +
            '<path d="M-60 1660 C 120 1600, 220 1820, 120 1980 L -60 1980 Z" fill="#12A372" opacity="0.22"/>',
    headline: column(
      text(anton(250, '#0B5D43', { letterSpacing: 4 }), 'BAIXOU'),
      text(script(84, '#0E7A56', { marginTop: -10 }), 'o preço'),
    ),
    card: {
      priceColor: '#0B7A55',
      couponBg: '#0B5D43',
      couponText: '#D6FBEA',
      discountBg: '#D6FBEA',
      discountText: '#0B5D43',
      imageBg: '#EEFAF4',
      cardStyle: { boxShadow: '0 30px 60px rgba(11,93,67,0.25)' },
    },
  });

/** Vermelho-laranja com chamas no topo e chamada inclinada. */
const hotDeal: StoryLayoutBuilder = (m) =>
  frame(m, {
    background: 'linear-gradient(180deg, #FF2A12 0%, #FF5A0A 50%, #FF9500 100%)',
    decor:
      '<path d="M0 0 H1080 V180 C 1010 260, 960 120, 900 230 C 840 340, 780 150, 700 250 C 630 340, 590 170, 520 260 C 450 350, 400 160, 320 250 C 250 330, 200 170, 140 240 C 80 310, 40 220, 0 260 Z" fill="#B3150A" opacity="0.55"/>' +
            '<path d="M0 1920 H1080 V1780 C 980 1700, 930 1820, 860 1740 C 790 1660, 720 1800, 640 1720 C 560 1650, 500 1790, 420 1730 C 340 1670, 280 1800, 200 1740 C 130 1690, 60 1780, 0 1730 Z" fill="#FFD23F" opacity="0.35"/>',
    headline: box(
      { flexDirection: 'column', alignItems: 'center', transform: 'rotate(-4deg)' },
      text(anton(210, '#FFFFFF', { textShadow: '8px 8px 0 #9E1206' }), 'OFERTA'),
      text(anton(210, '#FFE14D', { textShadow: '8px 8px 0 #9E1206', marginTop: -8 }), 'QUENTE'),
    ),
    card: {
      priceColor: '#D92A0B',
      couponBg: '#FFE14D',
      couponText: '#7A1400',
      discountBg: '#D92A0B',
      discountText: '#FFFFFF',
      imageBg: '#FFF3EC',
    },
  });

/** Cinza-azulado claro, tipografia preta e grade fina: indicação sóbria. */
const cleanLight: StoryLayoutBuilder = (m) =>
  frame(m, {
    background: 'linear-gradient(180deg, #EEF1F5 0%, #E6EAF0 100%)',
    decor:
      Array.from({ length: 11 }, (_, i) => `<line x1="${i * 108}" y1="0" x2="${i * 108}" y2="1920" stroke="#D7DCE3" stroke-width="2"/>`).join(''),
    headline: box(
      { flexDirection: 'column', alignItems: 'flex-start', width: 940 },
      text({ fontFamily: 'Inter', fontWeight: 800, fontSize: 138, lineHeight: 1.0, color: '#16181D', letterSpacing: -5 }, 'Vale cada'),
      text({ fontFamily: 'Inter', fontWeight: 800, fontSize: 138, lineHeight: 1.0, color: '#16181D', letterSpacing: -5 }, 'centavo.'),
      text(
        {
          fontFamily: 'Inter',
          fontWeight: 700,
          fontSize: 38,
          color: '#FFFFFF',
          backgroundColor: '#16181D',
          borderRadius: 999,
          padding: '12px 30px',
          marginTop: 30,
        },
        'Indicação de hoje',
      ),
    ),
    card: {
      priceColor: '#16181D',
      couponBg: '#16181D',
      couponText: '#FFFFFF',
      discountBg: '#FFFFFF',
      discountText: '#16181D',
      imageBg: '#F3F5F8',
      cardStyle: { border: '2px solid #D7DCE3', boxShadow: '0 20px 40px rgba(22,24,29,0.08)' },
    },
  });

function sparkle(x: number, y: number, r: number, fill: string, opacity: number): string {
  const k = r * 0.22;
  return `<path d="M${x} ${y - r} Q${x + k} ${y - k} ${x + r} ${y} Q${x + k} ${y + k} ${x} ${y + r} Q${x - k} ${y + k} ${x - r} ${y} Q${x - k} ${y - k} ${x} ${y - r} Z" fill="${fill}" opacity="${opacity}"/>`;
}

/** Violeta com brilhos de quatro pontas: novidade que acabou de chegar. */
const newsViolet: StoryLayoutBuilder = (m) =>
  frame(m, {
    background: 'linear-gradient(165deg, #2E0A8C 0%, #5B1FD6 55%, #8B3DFF 100%)',
    decor:
      sparkle(150, 230, 70, '#F6D9FF', 0.9) +
            sparkle(930, 200, 46, '#FFFFFF', 0.85) +
            sparkle(990, 560, 30, '#F6D9FF', 0.7) +
            sparkle(80, 640, 26, '#FFFFFF', 0.6) +
            sparkle(1000, 1640, 60, '#F6D9FF', 0.4) +
            sparkle(70, 1780, 40, '#FFFFFF', 0.35),
    headline: column(
      text(anton(200, '#FFFFFF', { letterSpacing: 8 }), 'NOVIDADE'),
      text(script(80, '#F6D9FF', { marginTop: -4 }), 'acabou de chegar'),
    ),
    card: {
      priceColor: '#5B1FD6',
      couponBg: '#5B1FD6',
      couponText: '#FFFFFF',
      discountBg: '#F6D9FF',
      discountText: '#2E0A8C',
      imageBg: '#F4EEFF',
    },
  });

export const OFFER_STORY_LAYOUTS: Readonly<Record<string, StoryLayoutBuilder>> = {
  'flash-night': flashNight,
  'blue-burst': blueBurst,
  'pink-week': pinkWeek,
  'gold-neon': goldNeon,
  'fresh-mint': freshMint,
  'hot-deal': hotDeal,
  'clean-light': cleanLight,
  'news-violet': newsViolet,
};
