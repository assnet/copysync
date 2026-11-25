import { describe, expect, it } from 'vitest';
import { PRIVACY_SCREENS } from '@/features/privacy';
import { plansStrings } from '@/features/plans/strings';
import { navigationStrings } from '@/features/navigation/strings';
import { WATERMARK_POSITIONS, WATERMARK_SIZES } from './rules';
import { offerWatermarkStrings as t } from './strings';

/** Folhas de texto (funções chamadas com valores de exemplo). */
function leaves(node: unknown, path = ''): [string, string][] {
  if (typeof node === 'string') return [[path, node]];
  if (typeof node === 'function') return [[path, String((node as (a: number, b: number) => string)(1, 2))]];
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}

describe('offerWatermarkStrings', () => {
  it('todo texto preenchido e sem nome de marca do produto', () => {
    const all = leaves(t);
    expect(all.length).toBeGreaterThan(40);
    for (const [path, text] of all) {
      expect(text.trim(), path).not.toBe('');
      expect(text, path).not.toMatch(/copysync|waioprime/i);
    }
  });

  it('cobre todas as posições, tamanhos, problemas de texto e campos do 422', () => {
    for (const p of WATERMARK_POSITIONS) expect(t.position.options[p]).toBeTruthy();
    for (const s of WATERMARK_SIZES) expect(t.size.options[s]).toBeTruthy();
    for (const f of ['enabled', 'kind', 'text', 'position', 'size', 'opacity']) expect(t.errors.invalidField[f]).toBeTruthy();
  });

  it('menu, aviso de planos e flag de privacidade existem', () => {
    expect(navigationStrings.links.offerWatermark).toBe('Marca d\'água');
    expect(plansStrings.featureNotice.offerWatermark).toBeTruthy();
    const flags = PRIVACY_SCREENS.flatMap((s) => s.flags.map((f) => f.id as string));
    expect(flags).toContain('offerWatermark.logo');
  });
});
