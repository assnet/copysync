import { describe, it, expect } from 'vitest';
import { extractMentionPhonesFromText, resolveMentionNames } from './resolveMentionNames';

const names = new Map([['554799247313', 'Adriel Silva da Silveira']]);

describe('extractMentionPhonesFromText', () => {
  it('pega telefones marcados com @ sem repetir', () => {
    expect(extractMentionPhonesFromText('@554799247313 oi @554799247313 @5511999999999')).toEqual([
      '554799247313',
      '5511999999999',
    ]);
  });

  it('ignora @ colado a texto e e-mail', () => {
    expect(extractMentionPhonesFromText('x@554799247313 ana@mail.com')).toEqual([]);
  });
});

describe('resolveMentionNames', () => {
  it('troca telefone conhecido pelo nome e preserva o resto', () => {
    expect(resolveMentionNames('@554799247313 teste wweb', names)).toBe('@Adriel Silva da Silveira teste wweb');
  });

  it('mantém telefone desconhecido', () => {
    expect(resolveMentionNames('oi @5511999999999', names)).toBe('oi @5511999999999');
  });

  it('não altera texto sem menção', () => {
    expect(resolveMentionNames('sem menção', names)).toBe('sem menção');
  });
});
