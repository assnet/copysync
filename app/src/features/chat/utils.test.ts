import { describe, expect, it } from 'vitest';
import { formatLastMessagePreview, formatPhone } from './utils';

describe('formatPhone', () => {
  it('formata celular brasileiro de 13 dígitos com o nono dígito separado', () => {
    expect(formatPhone('5511988881234')).toBe('+55 11 9 8888-1234');
  });

  it('formata fixo/legado de 12 dígitos', () => {
    expect(formatPhone('554499881234')).toBe('+55 44 9988-1234');
  });

  it('devolve a entrada intacta quando o tamanho não é reconhecido', () => {
    expect(formatPhone('12345')).toBe('12345');
  });
});

describe('formatLastMessagePreview', () => {
  it('usa a legenda quando a mídia tem legenda', () => {
    expect(formatLastMessagePreview('IMAGE', 'orçamento')).toBe('📷 orçamento');
  });

  it('usa o rótulo do tipo quando a mídia não tem legenda', () => {
    expect(formatLastMessagePreview('IMAGE', null)).toBe('📷 Foto');
  });

  it('ignora a legenda em tipos sem preview textual', () => {
    expect(formatLastMessagePreview('AUDIO', 'qualquer coisa')).toBe('🎵 Áudio');
  });

  it('trata tipo ausente como texto', () => {
    expect(formatLastMessagePreview(null, 'oi')).toBe('oi');
    expect(formatLastMessagePreview(undefined, undefined)).toBe('');
  });
});
