import { describe, expect, it } from 'vitest';
import { compactLane } from './compactLane';

const T0 = Date.parse('2026-10-28T12:00:00Z');
const at = (s: number) => new Date(T0 + s * 1000);
const interval = { minMs: 60_000, maxMs: 120_000 };
const rand = () => 0.5; // folga = 90 s

describe('compactLane', () => {
  it('buraco depois do último envio: o próximo vai para uma folga depois dele', () => {
    const out = compactLane([{ id: 'a', notBefore: at(3600) }, { id: 'b', notBefore: at(3700) }], { now: at(10), lastClaimedAt: at(0), interval, rand });
    expect(out).toEqual([{ id: 'a', notBefore: at(90) }, { id: 'b', notBefore: at(190) }]);
  });

  it('não adianta o que já estava antes da folga nem leva para o passado', () => {
    expect(compactLane([{ id: 'a', notBefore: at(30) }], { now: at(10), lastClaimedAt: at(0), interval, rand })).toEqual([]);
    // Último envio há muito tempo: o piso é "agora", não o passado
    expect(compactLane([{ id: 'a', notBefore: at(3600) }], { now: at(1000), lastClaimedAt: at(0), interval, rand })).toEqual([{ id: 'a', notBefore: at(1000) }]);
  });

  it('buraco no meio (oferta pausada entre duas) vira uma folga; espaçamento normal se mantém', () => {
    const out = compactLane(
      [{ id: 'a', notBefore: at(0) }, { id: 'b', notBefore: at(100) }, { id: 'c', notBefore: at(5000) }, { id: 'd', notBefore: at(5070) }],
      { now: at(0), lastClaimedAt: null, interval, rand },
    );
    expect(out).toEqual([{ id: 'c', notBefore: at(190) }, { id: 'd', notBefore: at(260) }]);
  });

  it('sessão que nunca enviou: o primeiro horário fica (pode ser "esperar para começar")', () => {
    expect(compactLane([{ id: 'a', notBefore: at(3600) }], { now: at(0), lastClaimedAt: null, interval, rand })).toEqual([]);
  });

  it('sem nada saiu ainda e sem buraco: nada muda', () => {
    expect(compactLane([{ id: 'a', notBefore: at(50) }, { id: 'b', notBefore: at(150) }], { now: at(0), lastClaimedAt: null, interval, rand })).toEqual([]);
  });
});
