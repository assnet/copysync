import { describe, expect, it } from 'vitest';
import {
  applyListRemoval, applyListRename, collectKnownLists, countInList, listFilter, listFilterName, planListMembers,
  validateListName, LIST_NAME_MAX_LENGTH,
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

describe('planListMembers — quem fica na lista', () => {
  const conversas = [
    { id: 'a', lists: ['Auto peças'] },
    { id: 'b', lists: ['Clientes', 'Auto peças'] },
    { id: 'c', lists: ['Clientes'] },
    { id: 'd', lists: undefined },
  ];

  it('mesmos membros não muda nada', () => {
    expect(planListMembers(conversas, 'Auto peças', ['a', 'b'])).toEqual([]);
  });

  it('remover membro tira o nome só dele, preservando as outras listas', () => {
    expect(planListMembers(conversas, 'Auto peças', ['a'])).toEqual([
      { id: 'b', lists: ['Clientes'] },
    ]);
  });

  it('adicionar membro grava o nome nele, sem repetir nos que já têm', () => {
    expect(planListMembers(conversas, 'Auto peças', ['a', 'b', 'd'])).toEqual([
      { id: 'd', lists: ['Auto peças'] },
    ]);
  });

  it('lista nova sem membros não toca conversa alguma: a lista vazia vive no catálogo', () => {
    expect(planListMembers(conversas, 'Fornecedores', [])).toEqual([]);
  });

  it('não renomeia: o nome antigo fica onde está, o plano só cuida da pertença ao nome dado', () => {
    expect(planListMembers(conversas, 'Peças', ['a'])).toEqual([
      { id: 'a', lists: ['Auto peças', 'Peças'] },
    ]);
  });
});

describe('applyListRename / applyListRemoval — espelho local do servidor', () => {
  const conversas = [
    { id: 'a', lists: ['Auto peças'] },
    { id: 'b', lists: ['Clientes', 'Auto peças'] },
    { id: 'c', lists: ['Clientes'] },
    { id: 'd', lists: undefined },
  ];

  it('renomear troca o nome na posição em que estava e mantém a referência de quem não tem a lista', () => {
    const out = applyListRename(conversas, 'Auto peças', 'Peças');
    expect(out.map((c) => c.lists)).toEqual([['Peças'], ['Clientes', 'Peças'], ['Clientes'], undefined]);
    expect(out[2]).toBe(conversas[2]);
    expect(out[3]).toBe(conversas[3]);
  });

  it('renomear para um nome que a conversa já carrega não duplica', () => {
    expect(applyListRename(conversas, 'Auto peças', 'Clientes')[1].lists).toEqual(['Clientes']);
  });

  it('excluir tira o nome de todas e deixa as outras listas', () => {
    const out = applyListRemoval(conversas, 'Clientes');
    expect(out.map((c) => c.lists)).toEqual([['Auto peças'], ['Auto peças'], [], undefined]);
    expect(out[0]).toBe(conversas[0]);
  });
});
