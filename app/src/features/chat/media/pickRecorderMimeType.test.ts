import { describe, it, expect } from 'vitest';
import { extensionForRecorderMime, pickRecorderMimeType } from './pickRecorderMimeType';

const supports = (...types: string[]) => (t: string) => types.includes(t);

describe('formato de gravação escolhido para o navegador', () => {
  it('prefere Ogg/Opus quando o navegador grava nele (Firefox)', () => {
    const all = supports('audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4');
    expect(pickRecorderMimeType(all)).toBe('audio/ogg;codecs=opus');
  });

  it('cai para WebM/Opus quando não há Ogg (Chrome e Edge)', () => {
    expect(pickRecorderMimeType(supports('audio/webm;codecs=opus', 'audio/mp4'))).toBe('audio/webm;codecs=opus');
  });

  it('cai para MP4 quando só ele é suportado (Safari)', () => {
    expect(pickRecorderMimeType(supports('audio/mp4'))).toBe('audio/mp4');
  });

  it('sem nenhum suportado devolve vazio para o navegador escolher', () => {
    expect(pickRecorderMimeType(() => false)).toBe('');
  });
});

describe('extensão do arquivo de voz pelo formato gravado', () => {
  it.each([
    ['audio/ogg;codecs=opus', 'ogg'],
    ['audio/ogg; codecs=opus', 'ogg'],
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/webm', 'webm'],
    ['audio/mp4', 'm4a'],
    ['AUDIO/MP4; codecs=mp4a.40.2', 'm4a'],
  ])('%s vira .%s', (mime, ext) => {
    expect(extensionForRecorderMime(mime)).toBe(ext);
  });

  it.each(['', 'audio/wav', 'video/webm'])('formato desconhecido (%j) usa webm', (mime) => {
    expect(extensionForRecorderMime(mime)).toBe('webm');
  });
});
