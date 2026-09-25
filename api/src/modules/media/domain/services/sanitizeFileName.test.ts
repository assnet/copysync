import { describe, it, expect } from 'vitest';
import { sanitizeFileName } from './sanitizeFileName';

describe('sanitizeFileName', () => {
  it('mantém um nome comum intacto', () => {
    expect(sanitizeFileName('Relatório final.pdf')).toBe('Relatório final.pdf');
  });

  it('descarta diretórios e travessia de caminho', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
  });

  it('descarta caminho no formato Windows', () => {
    expect(sanitizeFileName('C:\\a\\b.pdf')).toBe('b.pdf');
  });

  it('remove caracteres de controle', () => {
    expect(sanitizeFileName('no\x00ta\x1f\x7f.pdf')).toBe('nota.pdf');
  });

  it('remove controles bidirecionais que disfarçam a extensão (U+202E)', () => {
    expect(sanitizeFileName('fatura\u202Efdp.exe')).toBe('faturafdp.exe');
  });

  it('remove todos os controles bidirecionais (U+202A–202E, U+2066–2069)', () => {
    expect(sanitizeFileName('\u202Aa\u202Bb\u202Cc\u202Dd\u2066e\u2067f\u2068g\u2069.txt')).toBe('abcdefg.txt');
  });

  it('remove pontos iniciais que tornariam o arquivo oculto', () => {
    expect(sanitizeFileName('..env')).toBe('env');
    expect(sanitizeFileName('.bashrc')).toBe('bashrc');
  });

  it('colapsa espaços repetidos e apara as pontas', () => {
    expect(sanitizeFileName('  meu   arquivo \t final .pdf  ')).toBe('meu arquivo final .pdf');
  });

  it('corta nomes de 300 caracteres em 200 mantendo a extensão', () => {
    const result = sanitizeFileName(`${'a'.repeat(300)}.pdf`);
    expect(result).toHaveLength(200);
    expect(result).toBe(`${'a'.repeat(196)}.pdf`);
  });

  it('conta caracteres, não unidades UTF-16, ao cortar (emoji não é partido ao meio)', () => {
    expect(sanitizeFileName(`${'😀'.repeat(300)}.pdf`)).toBe(`${'😀'.repeat(196)}.pdf`);
  });

  it('corta sem extensão quando o nome não tem ponto', () => {
    expect(sanitizeFileName('b'.repeat(300))).toBe('b'.repeat(200));
  });

  it.each(['', '   ', '\t \n', '..', '../', '\u202E'])('usa "arquivo" quando não sobra nome (%j)', (input) => {
    expect(sanitizeFileName(input)).toBe('arquivo');
  });

  it('usa "arquivo" quando o nome não é informado', () => {
    expect(sanitizeFileName(null)).toBe('arquivo');
    expect(sanitizeFileName(undefined)).toBe('arquivo');
  });
});
