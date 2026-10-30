import { box, clampText, image, svgDataUri, svg, text, type StoryNode, type StoryStyle } from './storyPrimitives';
import type { StoryLayoutModel } from './storyLayoutModel';

/**
 * Peças comuns dos templates (foto, preço, selo de desconto, cupom, chamada para o link).
 * Cada template escolhe cores, fonte e posição; o desenho base fica aqui para todos degradarem
 * igual (sem foto, sem preço, sem cupom, título longo, preço alto).
 */

export const STORY_W = 1080;
export const STORY_H = 1920;
/** Faixas seguras do Instagram: topo (perfil/barra) e base (resposta) sem informação essencial. */
export const SAFE_TOP = 220;
export const SAFE_BOTTOM = 200;

// ---------------------------------------------------------------- foto

export interface StickerOptions {
  width: number;
  /** Altura fixa; omitida = ocupa o espaço que sobra na coluna (flex). */
  height?: number;
  radius?: number;
  padding?: number;
  rotate?: number;
  background?: string;
  border?: string;
  /** Sombra: blur ≤ 50px (blur maior faz o resvg alocar região gigante e derrubar o processo). */
  shadow?: string;
  /** Cor do ícone quando não há foto. */
  placeholderColor?: string;
  style?: StoryStyle;
}

/** Ícone de sacola de compras (sem foto do produto): arte continua com um "produto". */
function bagIcon(color: string): StoryNode {
  const body =
    `<path d="M40 70 H160 L150 180 Q149 190 139 190 H61 Q51 190 50 180 Z" fill="${color}"/>` +
    `<path d="M72 78 V58 Q72 22 100 22 Q128 22 128 58 V78" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"/>` +
    `<circle cx="72" cy="96" r="7" fill="#FFFFFF"/><circle cx="128" cy="96" r="7" fill="#FFFFFF"/>`;
  return image(svgDataUri(svg(body, 200, 200)), 300, 300);
}

/**
 * "Sticker" com a foto do produto (produto costuma vir em fundo branco). A foto preenche a caixa
 * em `object-fit: contain`, então a caixa pode crescer/encolher com o espaço livre da arte.
 */
export function productSticker(m: StoryLayoutModel, o: StickerOptions): StoryNode {
  const pad = o.padding ?? 36;
  const inner = m.image
    ? box(
        { position: 'absolute', left: pad, top: pad, right: pad, bottom: pad },
        image(m.image.src, m.image.width, m.image.height, { width: '100%', height: '100%', objectFit: 'contain' }),
      )
    : bagIcon(o.placeholderColor ?? '#C9CED8');
  return box(
    {
      position: 'relative',
      width: o.width,
      ...(o.height ? { height: o.height, flexShrink: 0 } : { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 }),
      borderRadius: o.radius ?? 56,
      backgroundColor: o.background ?? '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
      ...(o.border ? { border: o.border } : {}),
      ...(o.shadow ? { boxShadow: o.shadow } : {}),
      ...(o.rotate ? { transform: `rotate(${o.rotate}deg)` } : {}),
      ...o.style,
    },
    inner,
  );
}

// ---------------------------------------------------------------- selo de desconto

function starPath(cx: number, cy: number, outer: number, inner: number, points: number): string {
  const step = Math.PI / points;
  const pts = Array.from({ length: points * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = i * step - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  });
  return `M${pts.join(' L')} Z`;
}

export interface BurstOptions {
  size: number;
  fill: string;
  color: string;
  stroke?: string;
  rotate?: number;
  points?: number;
  font?: string;
  style?: StoryStyle;
}

/** Selo estourado "-72% OFF" (só quando há preço "De"). */
export function burstBadge(m: StoryLayoutModel, o: BurstOptions): StoryNode | null {
  if (m.offPercent === null) return null;
  const s = o.size;
  const c = s / 2;
  const stroke = o.stroke ? ` stroke="${o.stroke}" stroke-width="${s * 0.03}" stroke-linejoin="round"` : '';
  const shape = svg(`<path d="${starPath(c, c, c * 0.97, c * 0.8, o.points ?? 16)}" fill="${o.fill}"${stroke}/>`, s, s);
  const font = o.font ?? 'Poppins';
  return box(
    {
      position: 'absolute',
      width: s,
      height: s,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundImage: `url(${svgDataUri(shape)})`,
      backgroundSize: `${s}px ${s}px`,
      transform: `rotate(${o.rotate ?? 12}deg)`,
      ...o.style,
    },
    text({ fontFamily: font, fontWeight: 900, fontSize: s * 0.3, lineHeight: 1, color: o.color, letterSpacing: -2 }, `-${m.offPercent}%`),
    text({ fontFamily: font, fontWeight: 900, fontSize: s * 0.13, lineHeight: 1, color: o.color, marginTop: s * 0.02, letterSpacing: 2 }, 'OFF'),
  );
}

// ---------------------------------------------------------------- preço

/** "R$ 1.299,90" → { int: "1.299", cents: ",90" }. */
function splitPrice(label: string): { int: string; cents: string } {
  const value = label.replace(/^R\$\s*/, '');
  const i = value.lastIndexOf(',');
  return i < 0 ? { int: value, cents: '' } : { int: value.slice(0, i), cents: value.slice(i) };
}

export interface PriceOptions {
  color: string;
  /** Cor do "De R$ …" riscado. */
  fromColor: string;
  font?: string;
  weight?: number;
  /** Tamanho do inteiro para até 3 dígitos; encolhe sozinho para preço alto. */
  size?: number;
  /** Rótulo antes do preço ("por", "só"...); com preço "De" vira a linha de baixo da pilha. */
  lead?: string;
  leadColor?: string;
  leadFont?: string;
  shadow?: string;
  style?: StoryStyle;
  fromStyle?: StoryStyle;
}

/** Tamanho do inteiro conforme o número de caracteres (cabe em ~900px até "12.999,90"). */
export function priceSize(label: string, base: number): number {
  const n = splitPrice(label).int.length;
  if (n <= 3) return base;
  if (n <= 5) return Math.round(base * 0.8);
  return Math.round(base * 0.66);
}

export function priceBlock(m: StoryLayoutModel, o: PriceOptions): StoryNode | null {
  if (!m.toLabel) return null;
  const { int, cents } = splitPrice(m.toLabel);
  const size = priceSize(m.toLabel, o.size ?? 180);
  const font = o.font ?? 'Poppins';
  const weight = o.weight ?? 900;
  const shadow: StoryStyle = o.shadow ? { textShadow: o.shadow } : {};
  // "De R$ 299,90 / por" empilhado à esquerda: o bloco fica com a altura do número só.
  const side = m.fromLabel
    ? box(
        { flexDirection: 'column', alignItems: 'flex-end', marginRight: 20, marginBottom: size * 0.12 },
        text(
          {
            fontFamily: 'Poppins',
            fontWeight: 700,
            fontSize: 38,
            lineHeight: 1.1,
            color: o.fromColor,
            textDecoration: 'line-through',
            ...o.fromStyle,
          },
          `De ${m.fromLabel}`,
        ),
        text({ fontFamily: o.leadFont ?? 'Caveat Brush', fontSize: 58, lineHeight: 1, color: o.leadColor ?? o.color }, o.lead ?? 'por'),
      )
    : o.lead
      ? text(
          { fontFamily: o.leadFont ?? 'Caveat Brush', fontSize: 64, lineHeight: 1, color: o.leadColor ?? o.color, marginRight: 16, marginBottom: size * 0.14 },
          o.lead,
        )
      : null;
  return box(
    { alignItems: 'flex-end', justifyContent: 'center', ...o.style },
    side,
    text(
      { fontFamily: font, fontWeight: weight, fontSize: size * 0.34, lineHeight: 1, color: o.color, marginBottom: size * 0.14, marginRight: 8, ...shadow },
      'R$',
    ),
    text({ fontFamily: font, fontWeight: weight, fontSize: size, lineHeight: 0.92, color: o.color, letterSpacing: -size * 0.03, ...shadow }, int),
    text(
      { fontFamily: font, fontWeight: weight, fontSize: size * 0.4, lineHeight: 1, color: o.color, marginBottom: size * 0.42, marginLeft: 4, ...shadow },
      cents,
    ),
  );
}

// ---------------------------------------------------------------- título

export interface TitleOptions {
  color: string;
  size?: number;
  font?: string;
  weight?: number;
  width?: number;
  align?: 'left' | 'center';
  lines?: number;
  style?: StoryStyle;
}

export function titleText(m: StoryLayoutModel, o: TitleOptions): StoryNode {
  const size = o.size ?? 48;
  return clampText(
    {
      width: o.width ?? 900,
      fontFamily: o.font ?? 'Poppins',
      fontWeight: o.weight ?? 700,
      fontSize: size,
      lineHeight: 1.18,
      color: o.color,
      textAlign: o.align ?? 'center',
      ...o.style,
    },
    m.title,
    o.lines ?? 2,
  );
}

// ---------------------------------------------------------------- cupom

export interface CouponOptions {
  background: string;
  color: string;
  /** Cor do tracejado e do selo de %. */
  accent: string;
  accentText: string;
  rotate?: number;
  style?: StoryStyle;
}

function scissors(color: string): StoryNode {
  const body =
    `<circle cx="14" cy="14" r="10" fill="none" stroke="${color}" stroke-width="5"/>` +
    `<circle cx="14" cy="46" r="10" fill="none" stroke="${color}" stroke-width="5"/>` +
    `<path d="M22 20 L56 46 M22 40 L56 14" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`;
  return image(svgDataUri(svg(body, 60, 60)), 40, 40, { marginRight: 18 });
}

/** Ticket recortável "CUPOM OFERTA10 | -10%": código em destaque, cabe 20 caracteres. */
export function couponTicket(m: StoryLayoutModel, o: CouponOptions): StoryNode | null {
  if (!m.coupon) return null;
  const long = m.coupon.code.length > 12;
  const codeSize = long ? 40 : 54;
  return box(
    {
      alignItems: 'center',
      padding: '14px 18px 14px 28px',
      borderRadius: 26,
      backgroundColor: o.background,
      border: `5px dashed ${o.accent}`,
      ...(o.rotate ? { transform: `rotate(${o.rotate}deg)` } : {}),
      ...o.style,
    },
    scissors(o.accent),
    box(
      { flexDirection: 'column' },
      text({ fontFamily: 'Poppins', fontWeight: 700, fontSize: 24, lineHeight: 1, letterSpacing: 4, color: o.color, opacity: 0.75 }, 'CUPOM'),
      text({ fontFamily: 'Poppins', fontWeight: 900, fontSize: codeSize, lineHeight: 1.1, letterSpacing: 2, color: o.color }, m.coupon.code),
    ),
    m.coupon.discountLabel
      ? text(
          {
            marginLeft: 22,
            padding: '10px 20px',
            borderRadius: 18,
            backgroundColor: o.accent,
            color: o.accentText,
            fontFamily: 'Poppins',
            fontWeight: 900,
            fontSize: long ? 36 : 44,
            lineHeight: 1,
          },
          m.coupon.discountLabel,
        )
      : null,
  );
}

// ---------------------------------------------------------------- chamada para o link

export interface CtaOptions {
  color: string;
  /** Tracejado da área onde o criador cola o sticker de link. */
  slotColor: string;
  label?: string;
  font?: string;
  size?: number;
  /** Versão maior (empilhada) quando sobra espaço, ex.: produto sem preço. */
  big?: boolean;
  style?: StoryStyle;
}

/** Seta desenhada a mão: sai do texto e desce em curva para a direita (área do link). */
function curlyArrow(color: string, w: number): StoryNode {
  const body =
    `<path d="M10 30 C 60 0, 120 10, 128 60 C 134 98, 96 104, 92 80 C 88 56, 130 50, 156 92" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"/>` +
    `<path d="M128 90 L158 96 L162 64" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
  return image(svgDataUri(svg(body, 172, 120)), w, Math.round((w * 120) / 172));
}

function linkIcon(color: string): StoryNode {
  const body =
    `<rect x="6" y="20" width="44" height="24" rx="12" fill="none" stroke="${color}" stroke-width="6"/>` +
    `<rect x="38" y="20" width="44" height="24" rx="12" fill="none" stroke="${color}" stroke-width="6"/>`;
  return image(svgDataUri(svg(body, 88, 64)), 66, 48);
}

/** Área tracejada onde o criador solta o sticker de link do Instagram. */
function linkSlot(color: string, width: number, height: number): StoryNode {
  return box(
    { width, height, borderRadius: 30, border: `5px dashed ${color}`, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    linkIcon(color),
  );
}

/** "Toque no link" + seta + área do sticker. Linha compacta (~130px) ou empilhada (`big`). */
export function ctaZone(o: CtaOptions): StoryNode {
  const label = o.label ?? 'Toque no link';
  const font = { fontFamily: o.font ?? 'Caveat Brush', lineHeight: 0.95, color: o.color };
  if (o.big) {
    return box(
      { flexDirection: 'column', alignItems: 'center', ...o.style },
      box(
        { alignItems: 'flex-end', marginBottom: 8 },
        text({ ...font, fontSize: (o.size ?? 72) * 1.4 }, label),
        curlyArrow(o.color, 130),
      ),
      linkSlot(o.slotColor, 600, 130),
    );
  }
  return box(
    { alignItems: 'center', ...o.style },
    box({ flexDirection: 'column', alignItems: 'flex-end' }, text({ ...font, fontSize: o.size ?? 72, textAlign: 'right' }, label)),
    curlyArrow(o.color, 118),
    linkSlot(o.slotColor, 440, 118),
  );
}

// ---------------------------------------------------------------- quadro e orçamento vertical

export interface FrameSpec {
  /** `background-image` CSS (gradientes; várias camadas separadas por vírgula). */
  background: string;
  /** Decoração absoluta, pintada antes (atrás) do conteúdo. */
  layers?: Array<StoryNode | null>;
  content: Array<StoryNode | null>;
  /** Decoração por cima do conteúdo (fitas, brilhos); nunca sobre preço/cupom. */
  overlays?: Array<StoryNode | null>;
  /** Espaço entre as peças da coluna. A foto (flex) absorve o que sobra. */
  gap?: number;
}

/** O satori encolhe filhos por padrão (flex-shrink 1): só a foto (`flexGrow`) pode ceder espaço. */
function rigid(node: StoryNode | null): StoryNode | null {
  if (!node || typeof node === 'string') return node;
  const style = (node.props.style ?? {}) as StoryStyle;
  if (style.flexGrow !== undefined) return node;
  return { ...node, props: { ...node.props, style: { ...style, flexShrink: 0 } } };
}

/** Quadro 1080×1920: conteúdo em coluna entre as faixas seguras, espaço livre dividido entre as peças. */
export function storyFrame(m: StoryLayoutModel, spec: FrameSpec): StoryNode {
  return box(
    {
      width: m.width,
      height: m.height,
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: '#000000',
      backgroundImage: spec.background,
    },
    ...(spec.layers ?? []),
    box(
      {
        // Sem padding: o satori não desconta padding do espaço livre ao distribuir flex-grow.
        position: 'absolute',
        left: 0,
        top: SAFE_TOP,
        width: STORY_W,
        height: STORY_H - SAFE_TOP - SAFE_BOTTOM,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: spec.gap ?? 26,
      },
      ...spec.content.map(rigid),
    ),
    ...(spec.overlays ?? []),
  );
}

/** Moldura da foto que ocupa o espaço livre; filhos absolutos (selo) ficam por cima. */
export function heroArea(width: number, ...children: Array<StoryNode | null>): StoryNode {
  return box({ position: 'relative', width, flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, flexDirection: 'column', alignItems: 'center' }, ...children);
}
