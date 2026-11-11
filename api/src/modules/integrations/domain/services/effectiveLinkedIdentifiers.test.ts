import { describe, expect, it } from 'vitest';
import { effectiveLinkedIdentifiers } from './effectiveLinkedIdentifiers';

describe('effectiveLinkedIdentifiers', () => {
  const linked = ['b', 'c', 'd'];

  it('limite 1 → só a principal', () => {
    expect(effectiveLinkedIdentifiers('a', linked, 1)).toEqual(['a']);
  });

  it('limite 2 → principal + 1 vinculada', () => {
    expect(effectiveLinkedIdentifiers('a', linked, 2)).toEqual(['a', 'b']);
  });

  it('limite 10 → todas, ordem preservada', () => {
    expect(effectiveLinkedIdentifiers('a', linked, 10)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('rebaixado: mais vinculadas que o limite corta o excedente', () => {
    expect(effectiveLinkedIdentifiers('a', ['b', 'c', 'd', 'e', 'f'], 3)).toEqual(['a', 'b', 'c']);
  });

  it('repetidos sem caixa saem uma vez, com a grafia original', () => {
    expect(effectiveLinkedIdentifiers('Loja', ['loja', 'Outra', 'OUTRA', 'mais'], 10)).toEqual([
      'Loja',
      'Outra',
      'mais',
    ]);
  });

  it('repetido da principal não consome vaga', () => {
    expect(effectiveLinkedIdentifiers('a', ['A', 'b', 'c'], 2)).toEqual(['a', 'b']);
  });

  it('principal nula → até limit − 1 vinculadas', () => {
    expect(effectiveLinkedIdentifiers(null, linked, 2)).toEqual(['b']);
    expect(effectiveLinkedIdentifiers(null, linked, 1)).toEqual([]);
  });

  it('limite < 1 vale como 1', () => {
    expect(effectiveLinkedIdentifiers('a', linked, 0)).toEqual(['a']);
    expect(effectiveLinkedIdentifiers('a', linked, -5)).toEqual(['a']);
  });
});
