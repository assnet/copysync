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
    // Com selo, o ticket leva só o código: um único percentual na arte
    expect(m.coupon).toEqual({ code: 'OFERTA10', discountLabel: null });
  });

  it('caso de produção: 7.999,00 → 887,00 com cupom de 80% mostra só 89% (selo), cupom literal', () => {
    const input = { ...base, fromCents: 799900, toCents: 88700, coupon: { code: 'PEDROSO', discountPercent: 80 } };
    const m = buildStoryLayoutModel(input);
    expect(m.offPercent).toBe(89);
    expect(m.coupon).toEqual({ code: 'PEDROSO', discountLabel: null });
    expect(buildStoryLayoutModel(input)).toEqual(m);
  });

  it('sem selo (sem preço), o % digitado do cupom é o único percentual', () => {
    const m = buildStoryLayoutModel({ ...base, fromCents: null, toCents: null, coupon: { code: 'PEDROSO', discountPercent: 80 } });
    expect(m.offPercent).toBeNull();
    expect(m.coupon).toEqual({ code: 'PEDROSO', discountLabel: '-80%' });
  });

  it.each([[39900, 11224, 10], [15000, 8000, 20], [799900, 88700, 80], [10000, 9900, 1], [null, null, 90], [null, 5000, 50]])(
    'nunca há dois percentuais na arte (De %s, Por %s, cupom %s%%)',
    (fromCents, toCents, discountPercent) => {
      const m = buildStoryLayoutModel({ ...base, fromCents, toCents, coupon: { code: 'X', discountPercent } });
      expect(m.offPercent !== null && m.coupon!.discountLabel !== null).toBe(false);
    },
  );

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
