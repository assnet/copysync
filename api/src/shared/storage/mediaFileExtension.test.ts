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
});
