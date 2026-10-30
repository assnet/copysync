import { box, image, text, type StoryNode, type StoryStyle } from './storyPrimitives';
import { STORY_IMAGE_BOX, type StoryLayoutModel } from './storyLayoutModel';

/** Cores do card por template; o desenho (proporções, tipografia, ordem) é o mesmo para todos. */
export interface StoryCardTheme {
  /** Cor do "Por R$" (precisa contraste sobre branco). */
  priceColor: string;
  couponBg: string;
  couponText: string;
  /** Selo do desconto dentro do cupom. */
  discountBg: string;
  discountText: string;
  /** Fundo da caixa sem foto (placeholder). */
  imageBg: string;
  /** Borda/sombra do card conforme o fundo do template. */
  cardStyle?: StoryStyle;
}

const CARD_WIDTH = 940;
const CARD_PADDING = 44;
const INNER_WIDTH = CARD_WIDTH - CARD_PADDING * 2;

/** Ícone neutro de foto (moldura + sol + montanha) para produto sem imagem. */
function imagePlaceholder(theme: StoryCardTheme): StoryNode {
  return box(
    {
      width: 260,
      height: 200,
      borderRadius: 36,
      border: '10px solid #C9CED8',
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: theme.imageBg,
    },
    box({ position: 'absolute', top: 34, right: 44, width: 44, height: 44, borderRadius: 22, backgroundColor: '#C9CED8' }),
    box({
      position: 'absolute',
      left: -20,
      bottom: -120,
      width: 210,
      height: 210,
      backgroundColor: '#C9CED8',
      transform: 'rotate(45deg)',
    }),
    box({
      position: 'absolute',
      left: 110,
      bottom: -90,
      width: 150,
      height: 150,
      backgroundColor: '#DCE0E7',
      transform: 'rotate(45deg)',
    }),
  );
}

function photo(model: StoryLayoutModel, theme: StoryCardTheme): StoryNode {
  const content = model.image
    ? image(model.image.src, model.image.width, model.image.height)
    : imagePlaceholder(theme);
  return box(
    {
      width: INNER_WIDTH,
      height: STORY_IMAGE_BOX.height + 20,
      borderRadius: 32,
      // Foto de produto costuma vir em fundo branco: caixa branca evita "recorte" visível.
      backgroundColor: model.image ? '#FFFFFF' : theme.imageBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content,
  );
}

function title(model: StoryLayoutModel): StoryNode {
  return {
    type: 'div',
    props: {
      style: {
        display: 'block',
        lineClamp: 3,
        marginTop: 30,
        width: INNER_WIDTH,
        fontFamily: 'Inter',
        fontWeight: 700,
        fontSize: 46,
        lineHeight: 1.2,
        color: '#16181D',
        wordBreak: 'break-word',
      },
      children: model.title,
    },
  };
}

function priceBlock(model: StoryLayoutModel, theme: StoryCardTheme): StoryNode | null {
  if (!model.toLabel) return null;
  const parts: StoryNode[] = [];
  if (model.fromLabel) {
    parts.push(
      text(
        { fontFamily: 'Inter', fontWeight: 400, fontSize: 36, color: '#6B7280', textDecoration: 'line-through' },
        `De ${model.fromLabel}`,
      ),
    );
  }
  parts.push(
    box(
      { alignItems: 'baseline', marginTop: model.fromLabel ? 2 : 0 },
      text({ fontFamily: 'Inter', fontWeight: 700, fontSize: 42, color: '#16181D', marginRight: 16 }, 'Por'),
      text(
        { fontFamily: 'Inter', fontWeight: 800, fontSize: 104, lineHeight: 1.05, color: theme.priceColor, letterSpacing: -2 },
        model.toLabel,
      ),
    ),
  );
  return box({ flexDirection: 'column', marginTop: 24 }, ...parts);
}

function couponBadge(model: StoryLayoutModel, theme: StoryCardTheme): StoryNode | null {
  if (!model.coupon) return null;
  // Código de até 20 caracteres numa linha só: fonte menor para códigos longos.
  const fontSize = model.coupon.code.length > 12 ? 32 : 40;
  const label = { fontFamily: 'Inter', fontWeight: 800, fontSize, color: theme.couponText, flexShrink: 0 };
  const parts: StoryNode[] = [
    text({ ...label, fontWeight: 700, marginRight: 12 }, 'CUPOM:'),
    text({ ...label, letterSpacing: 1 }, model.coupon.code),
  ];
  if (model.coupon.discountLabel) {
    parts.push(
      text(
        {
          marginLeft: 20,
          padding: '6px 18px',
          borderRadius: 999,
          backgroundColor: theme.discountBg,
          color: theme.discountText,
          fontFamily: 'Inter',
          fontWeight: 800,
          fontSize: fontSize - 4,
          flexShrink: 0,
        },
        model.coupon.discountLabel,
      ),
    );
  }
  return box(
    {
      marginTop: 26,
      alignSelf: 'flex-start',
      alignItems: 'center',
      padding: '16px 30px',
      borderRadius: 22,
      backgroundColor: theme.couponBg,
      border: `4px dashed ${theme.couponText}`,
    },
    ...parts,
  );
}

/** Card branco comum a todos os templates: foto, título (3 linhas), preço e cupom. */
export function storyCard(model: StoryLayoutModel, theme: StoryCardTheme): StoryNode {
  const children = [photo(model, theme), title(model), priceBlock(model, theme), couponBadge(model, theme)].filter(
    (n): n is StoryNode => n !== null,
  );
  return box(
    {
      flexDirection: 'column',
      width: CARD_WIDTH,
      padding: CARD_PADDING,
      borderRadius: 48,
      backgroundColor: '#FFFFFF',
      boxShadow: '0 30px 60px rgba(0,0,0,0.28)',
      ...theme.cardStyle,
    },
    ...children,
  );
}
