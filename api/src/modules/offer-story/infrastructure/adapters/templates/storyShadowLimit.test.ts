import { describe, expect, it } from 'vitest';
import { OFFER_STORY_TEMPLATES } from '../../../domain/offerStoryTemplates';
import { OFFER_STORY_LAYOUTS } from './offerStoryLayouts';
import { buildStoryLayoutModel, type StoryModelInput } from './storyLayoutModel';
import type { StoryNode } from './storyPrimitives';

/**
 * `resvg` 2.6.2 dá panic (não capturável, derruba a API) com sombra de blur grande. Teto: 50 px em
 * `boxShadow`/`textShadow` e `stdDeviation` ≤ 25 em SVG embutido. Varre a árvore de todos os layouts.
 */
const MAX_BLUR_PX = 50;
const MAX_STD_DEVIATION = 25;

const CASES: StoryModelInput[] = [
  { width: 1080, height: 1920, title: 'Fone de ouvido Bluetooth', image: { src: 'data:image/png;base64,AA==', width: 600, height: 600 }, fromCents: 29990, toCents: 19990, coupon: { code: 'OFERTA10', discountPercent: 10 } },
  { width: 1080, height: 1920, title: 'x'.repeat(200), image: null, fromCents: null, toCents: null, coupon: null },
];

function shadowBlurs(value: string): number[] {
  // cada sombra: <x> <y> <blur>? <spread>? <cor>; pega o 3º comprimento de cada camada
  return value.split(/,(?![^(]*\))/).flatMap((layer) => {
    const lengths = layer.trim().match(/-?\d+(\.\d+)?px|\b0\b/g) ?? [];
    return lengths.length >= 3 ? [parseFloat(lengths[2])] : [];
  });
}

function collect(node: StoryNode, out: { blurs: number[]; stds: number[] }): void {
  if (typeof node === 'string') return;
  const style = (node.props.style ?? {}) as Record<string, unknown>;
  for (const key of ['boxShadow', 'textShadow']) {
    const v = style[key];
    if (typeof v === 'string') out.blurs.push(...shadowBlurs(v));
  }
  const strings = [node.props.src, style.backgroundImage].filter((s): s is string => typeof s === 'string');
  for (const s of strings) {
    for (const m of s.matchAll(/data:image\/svg\+xml[^)'"]*/g)) {
      const svg = decodeURIComponent(m[0]);
      for (const d of svg.matchAll(/stdDeviation=["']?([\d.]+)/g)) out.stds.push(parseFloat(d[1]));
    }
  }
  const children = node.props.children;
  for (const c of Array.isArray(children) ? children : [children]) if (c) collect(c as StoryNode, out);
}

describe('limite de blur dos templates (panic do resvg)', () => {
  it.each(OFFER_STORY_TEMPLATES.map((t) => t.id))('%s não passa de 50px de blur', (id) => {
    for (const input of CASES) {
      const out = { blurs: [] as number[], stds: [] as number[] };
      collect(OFFER_STORY_LAYOUTS[id](buildStoryLayoutModel(input)), out);
      expect(Math.max(0, ...out.blurs)).toBeLessThanOrEqual(MAX_BLUR_PX);
      expect(Math.max(0, ...out.stds)).toBeLessThanOrEqual(MAX_STD_DEVIATION);
    }
  });

  it('o detector pega blur acima do teto', () => {
    expect(shadowBlurs('0 0 8px #fff, 0 0 60px #f0f')).toEqual([8, 60]);
  });
});
