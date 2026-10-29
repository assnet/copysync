import { describe, expect, it } from 'vitest';
import { respreadLane } from './respreadLane';

const T0 = Date.parse('2026-10-28T12:00:00Z');
const at = (s: number) => new Date(T0 + s * 1000);
const interval = { minMs: 100_000, maxMs: 200_000 };
const rand = () => 0.5; // folga = 150 s

describe('respreadLane', () => {
  it('vencidos saem a partir de agora, na ordem, com o espaçamento original (mínimo garantido)', () => {
    const out = respreadLane(
      [{ id: 'a', notBefore: at(-3000) }, { id: 'b', notBefore: at(-2880) }, { id: 'c', notBefore: at(-2870) }],
      { now: at(0), lastClaimedAt: at(-4200), interval, rand },
    );
    expect(out).toEqual([{ id: 'a', notBefore: at(0) }, { id: 'b', notBefore: at(120) }, { id: 'c', notBefore: at(220) }]);
  });

  it('último envio há pouco: o primeiro espera a folga; buraco grande entre vencidos vira uma folga', () => {
    const out = respreadLane([{ id: 'a', notBefore: at(-5000) }, { id: 'b', notBefore: at(-100) }], { now: at(0), lastClaimedAt: at(-30), interval, rand });
    expect(out).toEqual([{ id: 'a', notBefore: at(120) }, { id: 'b', notBefore: at(270) }]);
  });

  it('horário ainda no futuro é mantido; nada a mudar devolve vazio', () => {
    expect(respreadLane([{ id: 'a', notBefore: at(600) }, { id: 'b', notBefore: at(720) }], { now: at(0), lastClaimedAt: null, interval, rand })).toEqual([]);
  });

  it('vencido antes de um futuro: o vencido sai agora e o futuro fica (não é puxado)', () => {
    const out = respreadLane([{ id: 'a', notBefore: at(-100) }, { id: 'b', notBefore: at(600) }], { now: at(0), lastClaimedAt: null, interval, rand });
    expect(out).toEqual([{ id: 'a', notBefore: at(0) }]);
  });

  it('futuro alcançado pelo reespalhar entra na cadeia (mínimo respeitado)', () => {
    const out = respreadLane([{ id: 'a', notBefore: at(-200) }, { id: 'b', notBefore: at(-100) }, { id: 'c', notBefore: at(50) }], { now: at(0), lastClaimedAt: null, interval, rand });
    // c (futuro em +50) seria alcançado: entra na cadeia com o espaçamento original de 150 s
    expect(out).toEqual([{ id: 'a', notBefore: at(0) }, { id: 'b', notBefore: at(100) }, { id: 'c', notBefore: at(250) }]);
  });
});
