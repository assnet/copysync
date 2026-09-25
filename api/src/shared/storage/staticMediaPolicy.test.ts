import { describe, it, expect } from 'vitest';
import { contentDispositionFor, isAllowedMediaPath, contentDispositionHeader, sanitizeDownloadName } from './staticMediaPolicy';

describe('isAllowedMediaPath', () => {
  it('libera arquivo dentro de media/, inclusive avatar salvo ali', () => {
    expect(isAllowedMediaPath('/media/sess_abc123.jpg')).toBe(true);
    expect(isAllowedMediaPath('/media/avatar_c_5511999999999@s.whatsapp.net.jpg')).toBe(true);
  });

  it('nega quem tenta sair de media/ com ..', () => {
    expect(isAllowedMediaPath('/media/../x')).toBe(false);
    expect(isAllowedMediaPath('/media/../.uploads/parte.bin')).toBe(false);
  });

  it('nega a pasta de uploads e qualquer arquivo fora de media/', () => {
    expect(isAllowedMediaPath('/.uploads/x')).toBe(false);
    expect(isAllowedMediaPath('/avatar.jpg')).toBe(false);
    expect(isAllowedMediaPath('/media')).toBe(false);
    expect(isAllowedMediaPath('/mediax/a.jpg')).toBe(false);
  });

  it('nega arquivo ou pasta oculta, mesmo dentro de media/', () => {
    expect(isAllowedMediaPath('/media/.oculto')).toBe(false);
    expect(isAllowedMediaPath('/media/sub/.oculto/a.jpg')).toBe(false);
  });

  it('nega caminho vazio', () => {
    expect(isAllowedMediaPath('')).toBe(false);
  });
});

describe('contentDispositionFor', () => {
  it('abre inline imagem, vídeo, áudio e PDF, como já acontece hoje', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', '3gp', '3gpp', 'ogg', 'opus', 'mp3', 'm4a', 'aac', 'pdf']) {
      expect(contentDispositionFor(ext)).toBe('inline');
    }
  });

  it('ignora maiúsculas e o ponto inicial da extensão', () => {
    expect(contentDispositionFor('JPG')).toBe('inline');
    expect(contentDispositionFor('.Pdf')).toBe('inline');
  });

  it('força download de tipo que pode executar script na origem da API', () => {
    for (const ext of ['svg', 'html', 'htm', 'xml', 'SVG', '.html']) {
      expect(contentDispositionFor(ext)).toBe('attachment');
    }
  });

  it('força download de extensão desconhecida ou ausente', () => {
    expect(contentDispositionFor('docx')).toBe('attachment');
    expect(contentDispositionFor('bin')).toBe('attachment');
    expect(contentDispositionFor('')).toBe('attachment');
  });
});

describe('contentDispositionHeader', () => {
  it('sem nome devolve só a disposição', () => {
    expect(contentDispositionHeader('.zip')).toBe('attachment');
    expect(contentDispositionHeader('.pdf')).toBe('inline');
  });

  it('com nome, manda filename ASCII e filename* com o nome original', () => {
    expect(contentDispositionHeader('.zip', 'relatório final.zip')).toBe(
      `attachment; filename="relat_rio final.zip"; filename*=UTF-8''relat%C3%B3rio%20final.zip`,
    );
  });

  it('PDF com nome continua inline, mas nomeado', () => {
    expect(contentDispositionHeader('.pdf', 'a.pdf')).toBe(`inline; filename="a.pdf"; filename*=UTF-8''a.pdf`);
  });
});

describe('sanitizeDownloadName', () => {
  it('remove caminho, aspas, controle e bidi', () => {
    expect(sanitizeDownloadName('../x/"a\u202eb".pdf')).toBe('..xab.pdf');
    expect(sanitizeDownloadName('a\x00b\n c.txt')).toBe('ab c.txt');
  });

  it('vazio, só espaços, "." e ".." viram null', () => {
    for (const v of ['', '   ', '.', '..', 42, null]) expect(sanitizeDownloadName(v)).toBeNull();
  });
});
