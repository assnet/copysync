import { describe, it, expect } from 'vitest';
import { buildWaveform } from './buildWaveform';

/** 64 blocos de `porBloco` níveis, cada bloco com o valor de `valor(i)`. */
function blocos(porBloco: number, valor: (i: number) => number): number[] {
  return Array.from({ length: 64 * porBloco }, (_, k) => valor(Math.floor(k / porBloco)));
}

describe('buildWaveform', () => {
  it('sempre devolve 64 valores entre 0 e 100', () => {
    const onda = buildWaveform(blocos(10, (i) => (i * 37) % 1000));
    expect(onda).toBeInstanceOf(Uint8Array);
    expect(onda).toHaveLength(64);
    expect(Math.min(...onda)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...onda)).toBe(100);
  });

  it('normaliza pelo bloco mais alto e arredonda para baixo', () => {
    const onda = buildWaveform(blocos(2, (i) => (i === 0 ? 1000 : i === 1 ? 500 : 333)));
    expect(onda[0]).toBe(100);
    expect(onda[1]).toBe(50);
    expect(onda[2]).toBe(33);
  });

  it('usa a média do valor absoluto de cada bloco', () => {
    const niveis = blocos(2, () => 10);
    niveis[0] = -100;
    niveis[1] = 100;
    niveis[2] = -50;
    niveis[3] = 0;
    const onda = buildWaveform(niveis);
    expect(onda[0]).toBe(100);
    expect(onda[1]).toBe(25);
    expect(onda[2]).toBe(10);
  });

  it('marca 100 no pico mesmo quando o inverso do máximo perde precisão', () => {
    // 49 * (1 / 49) = 0.9999999999999999: multiplicar pelo inverso daria 99
    expect(buildWaveform(blocos(1, () => 49))[0]).toBe(100);
  });

  it('descarta o resto que não fecha um bloco, como o WhatsApp', () => {
    const niveis = [...blocos(1, () => 10), 10_000];
    expect(Array.from(buildWaveform(niveis))).toEqual(new Array(64).fill(100));
  });

  it('aceita amostras PCM de 16 bits', () => {
    const pcm = Int16Array.from(blocos(4, (i) => (i % 2 === 0 ? -32768 : 16384)));
    const onda = buildWaveform(pcm);
    expect(onda[0]).toBe(100);
    expect(onda[1]).toBe(50);
  });

  it('devolve 64 zeros para silêncio', () => {
    expect(Array.from(buildWaveform(new Array(640).fill(0)))).toEqual(new Array(64).fill(0));
  });

  it('devolve 64 zeros sem níveis', () => {
    expect(Array.from(buildWaveform([]))).toEqual(new Array(64).fill(0));
  });

  it('estica menos de 64 níveis repetindo cada um, sem NaN', () => {
    const onda = Array.from(buildWaveform([100, 50]));
    expect(onda).toHaveLength(64);
    expect(onda.slice(0, 32)).toEqual(new Array(32).fill(100));
    expect(onda.slice(32)).toEqual(new Array(32).fill(50));
  });

  it('com um único nível preenche a onda inteira', () => {
    expect(Array.from(buildWaveform([-7]))).toEqual(new Array(64).fill(100));
  });
});
