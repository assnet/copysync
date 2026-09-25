import { describe, it, expect } from 'vitest';
import { mimeTypeToExt } from './mediaFileExtension';

describe('mimeTypeToExt', () => {
  // Trava o mapa que o download da mídia recebida já usava: mudar qualquer saída daqui muda o
  // nome do arquivo novo recebido e o eco do próprio envio deixa de achar o arquivo no disco.
  it.each([
    ['audio/mpeg', 'mp3'],
    ['audio/mp3', 'mp3'],
    ['audio/mp4', 'm4a'],
    ['audio/x-m4a', 'm4a'],
    ['audio/aac', 'aac'],
    ['audio/ogg', 'ogg'],
    ['image/jpeg', 'jpg'],
    ['image/jpg', 'jpg'],
    ['video/mp4', 'mp4'],
    ['video/mpeg', 'mpeg'],
  ])('mantém a extensão que a mídia recebida já usava: %s → %s', (mime, ext) => {
    expect(mimeTypeToExt(mime)).toBe(ext);
  });

  it('ignora parâmetros e caixa do MIME type', () => {
    expect(mimeTypeToExt('audio/ogg; codecs=opus')).toBe('ogg');
    expect(mimeTypeToExt('audio/ogg;codecs=opus')).toBe('ogg');
    expect(mimeTypeToExt(' IMAGE/JPEG ')).toBe('jpg');
  });

  it('usa o subtipo quando o MIME type não está no mapa', () => {
    expect(mimeTypeToExt('image/heic')).toBe('heic');
    expect(mimeTypeToExt('audio/opus')).toBe('opus');
    expect(mimeTypeToExt('application/x-rar-compressed')).toBe('x-rar-compressed');
  });

  it('cai em bin sem MIME type ou sem subtipo', () => {
    expect(mimeTypeToExt(null)).toBe('bin');
    expect(mimeTypeToExt(undefined)).toBe('bin');
    expect(mimeTypeToExt('')).toBe('bin');
    expect(mimeTypeToExt('semsubtipo')).toBe('bin');
  });

  it('mantém 3gpp para vídeo 3GPP, como o download já gerava', () => {
    expect(mimeTypeToExt('video/3gpp')).toBe('3gpp');
  });

  it.each([
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
    ['application/pdf', 'pdf'],
    ['video/quicktime', 'mov'],
    ['application/zip', 'zip'],
    ['application/octet-stream', 'bin'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
    ['application/msword', 'doc'],
    ['application/vnd.ms-excel', 'xls'],
    ['application/vnd.ms-powerpoint', 'ppt'],
    ['text/plain', 'txt'],
    ['text/csv', 'csv'],
  ])('dá extensão curta ao que o envio de mídia aceita: %s → %s', (mime, ext) => {
    expect(mimeTypeToExt(mime)).toBe(ext);
  });

  it('reconhece texto com charset', () => {
    expect(mimeTypeToExt('text/plain; charset=utf-8')).toBe('txt');
  });

  // Trava o fallback pelo subtipo para os tipos reais: o endurecimento abaixo não pode mudar
  // o nome de nenhum arquivo recebido de tipo normal.
  it.each([
    ['image/heic', 'heic'],
    ['image/avif', 'avif'],
    ['image/svg+xml', 'svg+xml'],
    ['audio/opus', 'opus'],
    ['audio/amr', 'amr'],
    ['video/webm', 'webm'],
    ['video/x-matroska', 'x-matroska'],
    ['application/x-7z-compressed', 'x-7z-compressed'],
    ['application/vnd.android.package-archive', 'vnd.android.package-archive'],
    ['application/vnd.ms-excel.sheet.macroenabled.12', 'vnd.ms-excel.sheet.macroenabled.12'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.template', 'vnd.openxmlformats-officedocument.wordprocessingml.template'],
  ])('mantém o subtipo de tipo normal fora do mapa: %s → %s', (mime, ext) => {
    expect(mimeTypeToExt(mime)).toBe(ext);
  });

  it.each([
    ['image/../../etc', 'caminho'],
    ['image/a..b', 'dois pontos seguidos'],
    ['image/.oculto', 'começa com ponto'],
    ['image/-x', 'começa com hífen'],
    ['application/x#y', 'cerquilha (corta a URL)'],
    ['application/x$y', 'cifrão'],
    ['application/x&y', 'e comercial'],
    ['application/x^y', 'circunflexo'],
    ['application/x_y', 'sublinhado'],
    ['application/x y', 'espaço'],
    ['image/jpé', 'fora do ASCII'],
    ['a/b/c', 'barra no subtipo'],
    ['text/', 'subtipo vazio'],
    [`application/${'a'.repeat(62)}`, 'mais de 61 caracteres'],
  ])('subtipo inseguro vira bin: %s (%s)', (mime) => {
    expect(mimeTypeToExt(mime)).toBe('bin');
  });

  it('aceita subtipo de exatamente 61 caracteres', () => {
    expect(mimeTypeToExt(`application/${'a'.repeat(61)}`)).toBe('a'.repeat(61));
  });
});
