import { describe, expect, it } from 'vitest';
import { fitSlots } from './fitSlots';

const H = 3_600_000;
const at = (h: number) => new Date(Date.UTC(2026, 10, 4, 0, 0) + h * H);
/** Janela 08–22 UTC: fora dela empurra para 08:00 do dia seguinte (ou do mesmo dia, antes das 8). */
const fit = (d: Date): Date => {
  const h = d.getUTCHours();
  if (h >= 8 && h < 22) return d;
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8));
  return h >= 22 ? new Date(next.getTime() + 24 * H) : next;
};

describe('fitSlots', () => {
  it('lista vazia devolve vazia', () => {
    expect(fitSlots([], fit)).toEqual([]);
  });

  it('identidade mantém os horários', () => {
    const slots = [at(1), at(2), at(5)];
    expect(fitSlots(slots, (d) => d)).toEqual(slots);
  });

  it('dentro da janela não muda nada', () => {
    const slots = [at(9), at(10), at(12)];
    expect(fitSlots(slots, fit)).toEqual(slots);
  });

  it('encaixa em cadeia preservando o espaçamento', () => {
    // 21:00, 23:00, 24:30 → 21:00, 08:00(+1d) (gap 2h aplicado sobre 21:00 = 23:00 → fora), 09:30(+1d)
    const slots = [at(21), at(23), at(24.5)];
    expect(fitSlots(slots, fit)).toEqual([at(21), at(32), at(33.5)]);
  });

  it('primeiro fora da janela puxa os seguintes junto', () => {
    const slots = [at(23), at(23.5), at(24)];
    expect(fitSlots(slots, fit)).toEqual([at(32), at(32.5), at(33)]);
  });

  it('não altera a entrada', () => {
    const slots = [at(23), at(24)];
    const copy = slots.map((d) => d.getTime());
    fitSlots(slots, fit);
    expect(slots.map((d) => d.getTime())).toEqual(copy);
  });
});
