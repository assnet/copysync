/**
 * Árvore aceita pelo satori, em objetos simples (sem React/JSX). Regras do satori que valem aqui:
 * div com mais de um filho precisa de `display: flex`; `lineClamp` exige `display: block`;
 * imagem só como data URI com `width`/`height`.
 */
export type StoryStyle = Record<string, string | number>;
export type StoryNode = { type: string; props: Record<string, unknown> } | string;

export function box(style: StoryStyle, ...children: StoryNode[]): StoryNode {
  return { type: 'div', props: { style: { display: 'flex', ...style }, children } };
}

export function text(style: StoryStyle, value: string): StoryNode {
  return { type: 'div', props: { style: { display: 'flex', ...style }, children: value } };
}

export function image(src: string, width: number, height: number, style: StoryStyle = {}): StoryNode {
  return { type: 'img', props: { src, width, height, style: { width, height, ...style } } };
}

/** SVG embutido (formas livres que o CSS do satori não desenha: raios, chamas, brilhos). */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** "R$ 1.299,90" com espaço comum (o NBSP do Intl vira espaço normal na arte). */
export function formatStoryCents(cents: number): string {
  return BRL.format(cents / 100).replace(/ /g, ' ');
}
