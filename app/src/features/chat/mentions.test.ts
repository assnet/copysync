import { describe, it, expect } from 'vitest';
import { applyMentionNames, extractMentionPhones, splitMentions } from './mentions';

const names = { '554799247313': 'Adriel Silva da Silveira' };

describe('extractMentionPhones', () => {
  it('pega telefones marcados com @ e ignora repetidos', () => {
    expect(extractMentionPhones('@554799247313 oi @554799247313 e @5511999999999')).toEqual([
      '554799247313',
      '5511999999999',
    ]);
  });

  it('ignora @ colado em palavra, e-mail e sequência curta', () => {
    expect(extractMentionPhones('fulano@554799247313 x@1234 ok')).toEqual([]);
  });
});

describe('splitMentions', () => {
  it('troca @<telefone> conhecido pelo nome e mantém o resto como texto', () => {
    expect(splitMentions('oi @554799247313 tudo bem', names)).toEqual([
      { kind: 'text', value: 'oi ' },
      { kind: 'mention', phone: '554799247313', name: 'Adriel Silva da Silveira' },
      { kind: 'text', value: ' tudo bem' },
    ]);
  });

  it('telefone sem nome no mapa fica como texto, igual contato desconhecido', () => {
    expect(splitMentions('@5511999999999 oi', names)).toEqual([{ kind: 'text', value: '@5511999999999 oi' }]);
  });

  it('não casa @ no meio de palavra', () => {
    expect(splitMentions('a@554799247313', names)).toEqual([{ kind: 'text', value: 'a@554799247313' }]);
  });
});

describe('applyMentionNames', () => {
  it('troca telefone conhecido pelo nome na prévia', () => {
    expect(applyMentionNames('@554799247313 teste wweb', names)).toBe('@Adriel Silva da Silveira teste wweb');
  });

  it('mantém desconhecido e texto sem menção', () => {
    expect(applyMentionNames('oi @5511999999999', names)).toBe('oi @5511999999999');
    expect(applyMentionNames('sem menção', names)).toBe('sem menção');
  });
});
