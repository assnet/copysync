import { describe, expect, it } from 'vitest';
import { BRAZIL_DDDS, brazilDddOf, ddiOf, isCountryCode, summarizePhonePrefixes } from './phoneRegions';

describe('ddiOf', () => {
  it('reconhece DDI de 1, 2 e 3 dígitos sem recorte cego', () => {
    expect(ddiOf('5511999990000')).toBe('55');
    expect(ddiOf('14155550100')).toBe('1');
    expect(ddiOf('79161234567')).toBe('7');
    expect(ddiOf('351912345678')).toBe('351');
    expect(ddiOf('5491122334455')).toBe('54');
    expect(ddiOf('595981123456')).toBe('595');
    expect(ddiOf('551')).toBe('55');
  });

  it('vazio, com letra ou curto demais = null', () => {
    expect(ddiOf(null)).toBeNull();
    expect(ddiOf('')).toBeNull();
    expect(ddiOf('+5511')).toBeNull();
    expect(ddiOf('35')).toBeNull();
    expect(ddiOf('0551199990000')).toBeNull();
  });
});

describe('isCountryCode', () => {
  it('só código inteiro de país', () => {
    for (const ok of ['1', '7', '55', '44', '351', '595']) expect(isCountryCode(ok), ok).toBe(true);
    for (const bad of ['5', '551', '12', '35', '', 'ab', '5511', '0', '00', '000', '055', '099']) expect(isCountryCode(bad), bad).toBe(false);
  });
});

describe('brazilDddOf', () => {
  it('só telefone do Brasil com DDD em uso', () => {
    expect(brazilDddOf('5511999990000')).toBe('11');
    expect(brazilDddOf('5520999990000')).toBeNull();
    expect(brazilDddOf('351119999')).toBeNull();
    expect(BRAZIL_DDDS).toHaveLength(67);
  });
});

describe('summarizePhonePrefixes', () => {
  const rows = [
    { prefix: '5511', count: 40 }, { prefix: '5521', count: 25 }, { prefix: '5520', count: 1 },
    { prefix: '3519', count: 7 }, { prefix: '1415', count: 3 }, { prefix: '1212', count: 2 },
    { prefix: null, count: 9 },
  ];
  const none = { ddi: null, ddd: null };

  it('sem DDI: totais, partição e ranking por país (prefixos do mesmo país somados)', () => {
    const out = summarizePhonePrefixes(rows, none);
    expect(out).toMatchObject({ filtered: 87, withPhone: 78, lidOnly: 9, topDdd: [], ddiBase: 78, dddBase: 0 });
    expect(out.topDdi).toEqual([{ ddi: '55', count: 66 }, { ddi: '351', count: 7 }, { ddi: '1', count: 5 }]);
  });

  it('com DDI: totais só do país, só LID fora; ranking de países segue inteiro', () => {
    const pt = summarizePhonePrefixes(rows, { ddi: '351', ddd: null });
    expect(pt).toMatchObject({ filtered: 7, withPhone: 7, lidOnly: 0, topDdd: [], ddiBase: 78, dddBase: 0 });
    expect(pt.topDdi).toHaveLength(3);
    expect(summarizePhonePrefixes(rows, { ddi: '1', ddd: null })).toMatchObject({ filtered: 5 });
    expect(summarizePhonePrefixes([{ prefix: '5511', count: 4 }, { prefix: '5519', count: 2 }], { ddi: '551', ddd: null }).filtered).toBe(0);
  });

  it('Brasil: ranking de DDD em uso segue inteiro com DDD filtrado; totais só do DDD', () => {
    const br = summarizePhonePrefixes(rows, { ddi: '55', ddd: null });
    expect(br).toMatchObject({ filtered: 66, withPhone: 66, lidOnly: 0 });
    expect(br.topDdd).toEqual([{ ddd: '11', count: 40 }, { ddd: '21', count: 25 }]);
    const rj = summarizePhonePrefixes(rows, { ddi: '55', ddd: '21' });
    // `5520…` (DDD que não existe) fica fora do ranking e da base das porcentagens dele.
    expect(rj).toMatchObject({ filtered: 25, withPhone: 25, lidOnly: 0, ddiBase: 78, dddBase: 65 });
    expect(rj.topDdd).toEqual(br.topDdd);
  });

  it('telefone sem DDI (começa por 0) conta em withPhone, fora do ranking e da base das porcentagens', () => {
    const out = summarizePhonePrefixes([{ prefix: '5511', count: 6 }, { prefix: '0119', count: 4 }], none);
    expect(out).toMatchObject({ filtered: 10, withPhone: 10, ddiBase: 6, topDdi: [{ ddi: '55', count: 6 }] });
  });

  it('limites de 5 países e 8 DDDs', () => {
    const many = BRAZIL_DDDS.slice(0, 12).map((d, i) => ({ prefix: `55${d}`, count: 100 - i }));
    expect(summarizePhonePrefixes(many, { ddi: '55', ddd: null }).topDdd).toHaveLength(8);
    const countries = ['20', '27', '30', '31', '32', '33', '34'].map((d, i) => ({ prefix: `${d}90`, count: 10 - i }));
    expect(summarizePhonePrefixes(countries, none).topDdi.map((d) => d.ddi)).toEqual(['20', '27', '30', '31', '32']);
  });
});
