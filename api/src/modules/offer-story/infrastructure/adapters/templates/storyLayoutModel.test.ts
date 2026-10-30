import { describe, expect, it } from 'vitest';
import { buildStoryLayoutModel, type StoryModelInput } from './storyLayoutModel';

const base: StoryModelInput = {
  width: 1080,
  height: 1920,
  title: '  Fone Bluetooth  ',
  image: null,
  fromCents: 39900,
  toCents: 11224,
  coupon: { code: 'OFERTA10', discountPercent: 10 },
};

describe('buildStoryLayoutModel', () => {
  it('formata preços e calcula o % do selo', () => {
    const m = buildStoryLayoutModel(base);
    expect(m.title).toBe('Fone Bluetooth');
    expect(m.toLabel).toBe('R$ 112,24');
    expect(m.fromLabel).toBe('R$ 399,00');
    expect(m.offPercent).toBe(72);
    expect(m.coupon).toEqual({ code: 'OFERTA10', discountLabel: '-10%' });
  });

  it('sem "De" maior que "Por" não há selo nem preço riscado', () => {
    for (const fromCents of [null, 11224, 9000]) {
      const m = buildStoryLayoutModel({ ...base, fromCents });
      expect([m.fromLabel, m.offPercent]).toEqual([null, null]);
    }
  });

  it('sem preço: nada de preço nem selo; cupom sem % fica sem rótulo', () => {
    const m = buildStoryLayoutModel({ ...base, toCents: null, coupon: { code: 'X', discountPercent: null } });
    expect([m.toLabel, m.fromLabel, m.offPercent]).toEqual([null, null, null]);
    expect(m.coupon?.discountLabel).toBeNull();
  });

  it('% fica entre 1 e 99 mesmo com arredondamento extremo', () => {
    expect(buildStoryLayoutModel({ ...base, fromCents: 100000, toCents: 1 }).offPercent).toBe(99);
    expect(buildStoryLayoutModel({ ...base, fromCents: 100000, toCents: 99999 }).offPercent).toBe(1);
  });
});
