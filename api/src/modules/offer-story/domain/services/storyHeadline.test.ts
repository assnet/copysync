import { describe, expect, it } from 'vitest';
import { sanitizeStoryHeadline } from './storyHeadline';
import { OFFER_STORY_HEADLINE_MAX } from '../offerStoryRules';

describe('sanitizeStoryHeadline', () => {
  it.each([
    ['"Fone Bluetooth com cancelamento"', 'Fone Bluetooth com cancelamento'],
    ['“Air fryer 4L”', 'Air fryer 4L'],
    ['🔥 Oferta de fone 🎧', 'Oferta de fone'],
    ['Linha 1\nLinha 2\r\n  fim ', 'Linha 1 Linha 2 fim'],
    ['**Kit 3 peças**', 'Kit 3 peças'],
    ['Smart TV 50 polegadas 4K', 'Smart TV 50 polegadas 4K'],
  ])('%j → %j', (raw, expected) => {
    expect(sanitizeStoryHeadline(raw)).toBe(expected);
  });

  it.each([[''], ['   '], ['"🔥"'], [null], [undefined], ['Fone por R$ 99'], ['Fone por r$99'], ['Só 199,90 hoje']])(
    '%j → null',
    (raw) => {
      expect(sanitizeStoryHeadline(raw)).toBeNull();
    },
  );

  it('corta na última palavra inteira dentro do teto, sem pontuação no fim', () => {
    const raw = 'Fone de ouvido Bluetooth sem fio com cancelamento de ruído, estojo e microfone';
    const out = sanitizeStoryHeadline(raw)!;
    expect(out.length).toBeLessThanOrEqual(OFFER_STORY_HEADLINE_MAX);
    expect(raw.startsWith(out)).toBe(true);
    expect(out).not.toMatch(/[\s,]$/);
    expect(out).toBe('Fone de ouvido Bluetooth sem fio com cancelamento de ruído');
  });

  it('palavra única maior que o teto: corte seco', () => {
    expect(sanitizeStoryHeadline('x'.repeat(80))).toBe('x'.repeat(OFFER_STORY_HEADLINE_MAX));
  });
});
