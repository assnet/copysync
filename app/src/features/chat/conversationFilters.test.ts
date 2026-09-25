import { describe, expect, it } from 'vitest';
import {
  collectKnownLists, countInList, listFilter, listFilterName, planListUpdate, validateListName, LIST_NAME_MAX_LENGTH,
} from './conversationFilters';

describe('filtro por lista', () => {
  it('monta e lê o filtro de uma lista pelo nome', () => {
    expect(listFilter('Auto peças')).toBe('list:Auto peças');
    expect(listFilterName(listFilter('Auto peças'))).toBe('Auto peças');
  });

  it('os filtros fixos não são lista', () => {
    expect(listFilterName('all')).toBeNull();
    expect(listFilterName('favorite')).toBeNull();
    expect(listFilterName('list:')).toBeNull();
  });

  it('reúne as listas das conversas sem repetição e em ordem alfabética', () => {
    expect(collectKnownLists([
      { lists: ['Zeta', 'Auto peças'] },
      { lists: ['Auto peças'] },
      { lists: undefined },
      { lists: ['clientes'] },
    ])).toEqual(['Auto peças', 'clientes', 'Zeta']);
  });

  it('conta quantas conversas estão na lista', () => {
    const conversas = [{ lists: ['A'] }, { lists: ['A', 'B'] }, { lists: [] }, {}];
    expect(countInList(conversas, 'A')).toBe(2);
    expect(countInList(conversas, 'B')).toBe(1);
    expect(countInList(conversas, 'C')).toBe(0);
  });
});

describe('nome de nova lista', () => {
  it('aceita nome aparado e inédito', () => {
    expect(validateListName('  Clientes VIP ', ['Auto peças'])).toBeNull();
  });

  it('recusa vazio, só espaços e acima do limite', () => {
    expect(validateListName('', [])).toBe('empty');
    expect(validateListName('   ', [])).toBe('empty');
    expect(validateListName('x'.repeat(LIST_NAME_MAX_LENGTH + 1), [])).toBe('tooLong');
    expect(validateListName('x'.repeat(LIST_NAME_MAX_LENGTH), [])).toBeNull();
  });

  it('recusa nome já usado, sem diferenciar maiúsculas', () => {
    expect(validateListName('auto PEÇAS', ['Auto peças'])).toBe('duplicate');
    expect(validateListName(' Auto peças ', ['Auto peças'])).toBe('duplicate');
  });
});

describe('planListUpdate — editar e excluir lista', () => {
  const conversas = [
    { id: 'a', lists: ['Auto peças'] },
    { id: 'b', lists: ['Clientes', 'Auto peças'] },
    { id: 'c', lists: ['Clientes'] },
    { id: 'd', lists: undefined },
  ];

  it('renomear sem mudar membros regrava só quem tem a lista, preservando as outras', () => {
    expect(planListUpdate(conversas, 'Auto peças', 'Peças', ['a', 'b'])).toEqual([
      { id: 'a', lists: ['Peças'] },
      { id: 'b', lists: ['Clientes', 'Peças'] },
    ]);
  });

  it('mesmo nome e mesmos membros não muda nada', () => {
    expect(planListUpdate(conversas, 'Auto peças', 'Auto peças', ['a', 'b'])).toEqual([]);
  });

  it('remover membro tira o nome só dele', () => {
    expect(planListUpdate(conversas, 'Auto peças', 'Auto peças', ['a'])).toEqual([
      { id: 'b', lists: ['Clientes'] },
    ]);
  });

  it('adicionar membro grava o nome nele, sem repetir nos que já têm', () => {
    expect(planListUpdate(conversas, 'Auto peças', 'Auto peças', ['a', 'b', 'd'])).toEqual([
      { id: 'd', lists: ['Auto peças'] },
    ]);
  });

  it('excluir (nome novo nulo) remove de todas e ignora membros', () => {
    expect(planListUpdate(conversas, 'Clientes', null, ['a', 'b', 'c'])).toEqual([
      { id: 'b', lists: ['Auto peças'] },
      { id: 'c', lists: [] },
    ]);
  });

  it('renomear para um nome que o membro já carrega não duplica nem mexe em quem está fora', () => {
    expect(planListUpdate(conversas, 'Auto peças', 'Clientes', ['a', 'b'])).toEqual([
      { id: 'a', lists: ['Clientes'] },
      { id: 'b', lists: ['Clientes'] },
    ]);
  });
});
