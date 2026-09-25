import { describe, it, expect } from 'vitest';
import { sniffMediaType } from './sniffMediaType';

/** Monta o cabeçalho a partir de trechos em bytes ou texto ASCII. */
function bytes(...partes: (number[] | string)[]): Uint8Array {
  const lista: number[] = [];
  for (const parte of partes) {
    if (typeof parte === 'string') {
      for (const ch of parte) lista.push(ch.charCodeAt(0));
    } else {
      lista.push(...parte);
    }
  }
  return new Uint8Array(lista);
}

/** Caixa `ftyp` ISO-BMFF: tamanho (4) + `ftyp` + brand principal + versão. */
const ftyp = (brand: string) => bytes([0x00, 0x00, 0x00, 0x20], 'ftyp', brand, [0, 0, 0, 0]);

describe('sniffMediaType — assinaturas conhecidas', () => {
  it('reconhece JPEG', () => {
    expect(sniffMediaType(bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF'))).toEqual({
      mimeType: 'image/jpeg',
      demuxer: null,
    });
  });

  it('reconhece PNG', () => {
    const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 0x0d], 'IHDR');
    expect(sniffMediaType(png)).toEqual({ mimeType: 'image/png', demuxer: null });
  });

  it('reconhece WebP pelo RIFF com marca WEBP', () => {
    expect(sniffMediaType(bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 '))).toEqual({
      mimeType: 'image/webp',
      demuxer: null,
    });
  });

  it('não confunde outro RIFF (WAV) com WebP', () => {
    expect(sniffMediaType(bytes('RIFF', [0x24, 0, 0, 0], 'WAVEfmt '))).toEqual({
      mimeType: 'application/octet-stream',
      demuxer: null,
    });
  });

  it('reconhece GIF nas duas versões', () => {
    expect(sniffMediaType(bytes('GIF87a', [1, 0, 1, 0]))).toEqual({ mimeType: 'image/gif', demuxer: null });
    expect(sniffMediaType(bytes('GIF89a', [1, 0, 1, 0]))).toEqual({ mimeType: 'image/gif', demuxer: null });
  });

  it.each(['heic', 'heix', 'mif1', 'msf1'])('reconhece HEIC pela brand %s', (brand) => {
    expect(sniffMediaType(ftyp(brand))).toEqual({ mimeType: 'image/heic', demuxer: null });
  });

  it.each(['3gp4', '3gp5', '3gp6'])('reconhece 3GP pela brand %s e manda ao demuxer mov', (brand) => {
    expect(sniffMediaType(ftyp(brand))).toEqual({ mimeType: 'video/3gpp', demuxer: 'mov' });
  });

  it('reconhece QuickTime pela brand "qt  "', () => {
    expect(sniffMediaType(ftyp('qt  '))).toEqual({ mimeType: 'video/quicktime', demuxer: 'mov' });
  });

  it('reconhece áudio M4A pela brand "M4A "', () => {
    expect(sniffMediaType(ftyp('M4A '))).toEqual({ mimeType: 'audio/mp4', demuxer: 'mov' });
  });

  it.each(['isom', 'iso2', 'iso5', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash'])(
    'trata brand MP4 conhecida (%s) como MP4, sem marca de genérico',
    (brand) => {
      const sniffed = sniffMediaType(ftyp(brand), 'application/x-qualquer');
      expect(sniffed).toEqual({ mimeType: 'video/mp4', demuxer: 'mov' });
      expect(sniffed.generic).toBeUndefined();
    },
  );

  it.each(['avif', 'avis'])('reconhece AVIF pela brand %s, sem ffmpeg', (brand) => {
    expect(sniffMediaType(ftyp(brand))).toEqual({ mimeType: 'image/avif', demuxer: null });
  });

  it('reconhece WebM/Matroska pelo EBML', () => {
    expect(sniffMediaType(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]))).toEqual({
      mimeType: 'video/webm',
      demuxer: 'matroska',
    });
  });

  it('reconhece Ogg', () => {
    expect(sniffMediaType(bytes('OggS', [0x00, 0x02, 0, 0]))).toEqual({ mimeType: 'audio/ogg', demuxer: 'ogg' });
  });

  it('reconhece PDF', () => {
    expect(sniffMediaType(bytes('%PDF-1.7\n'))).toEqual({ mimeType: 'application/pdf', demuxer: null });
  });

  it('reconhece ZIP', () => {
    expect(sniffMediaType(bytes('PK', [0x03, 0x04, 0x14, 0, 0, 0]))).toEqual({
      mimeType: 'application/zip',
      demuxer: null,
    });
  });

  it('usa o tipo declarado quando o ZIP é documento Office', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(sniffMediaType(bytes('PK', [0x03, 0x04, 0x14, 0, 0, 0]), `${docx.toUpperCase()}; charset=x`)).toEqual({
      mimeType: docx,
      demuxer: null,
    });
  });

  it('mantém ZIP quando o declarado não é Office', () => {
    expect(sniffMediaType(bytes('PK', [0x03, 0x04, 0x14, 0, 0, 0]), 'text/html')).toEqual({
      mimeType: 'application/zip',
      demuxer: null,
    });
  });

  it('a assinatura prevalece sobre o tipo declarado', () => {
    expect(sniffMediaType(bytes([0xff, 0xd8, 0xff, 0xe0]), 'application/pdf')).toEqual({
      mimeType: 'image/jpeg',
      demuxer: null,
    });
  });
});

describe('sniffMediaType — ftyp de brand desconhecida', () => {
  it('cai em MP4 para o ffprobe confirmar, marcado como genérico e com o declarado saneado', () => {
    expect(sniffMediaType(ftyp('crx '), ' Application/X-Canon-CR3 ; q=1')).toEqual({
      mimeType: 'video/mp4',
      demuxer: 'mov',
      generic: true,
      declaredMimeType: 'application/x-canon-cr3',
    });
  });

  it('sem declarado válido, o genérico leva declarado nulo', () => {
    expect(sniffMediaType(ftyp('xxxx'))).toMatchObject({ generic: true, declaredMimeType: null });
    expect(sniffMediaType(ftyp('xxxx'), 'text/pl#ain')).toMatchObject({ generic: true, declaredMimeType: null });
  });
});

describe('sniffMediaType — sem assinatura', () => {
  const texto = bytes('ola, mundo\n');

  it('usa o declarado saneado (minúsculo e sem parâmetros), sem demuxer', () => {
    expect(sniffMediaType(texto, ' Text/Plain ; charset=UTF-8')).toEqual({ mimeType: 'text/plain', demuxer: null });
  });

  it('declarado com parâmetros perde os parâmetros', () => {
    expect(sniffMediaType(texto, 'text/html; charset=x')).toEqual({ mimeType: 'text/html', demuxer: null });
  });

  it('declarado com cara de caminho vira octet-stream', () => {
    expect(sniffMediaType(texto, '../x')).toEqual({ mimeType: 'application/octet-stream', demuxer: null });
  });

  it.each([
    '', '   ', 'texto', 'a/b/c', 'text/', '/plain', 'text/pl ain', 'text/plain\r\nX-Evil: 1',
    'text/pl#ain', 'application/x$y', 'application/a&b', 'application/a^b', 'application/x_y', 'application/x!y',
    'image/.png', 'image/-png',
  ])(
    'declarado inválido %j vira octet-stream',
    (declarado) => {
      expect(sniffMediaType(texto, declarado)).toEqual({ mimeType: 'application/octet-stream', demuxer: null });
    },
  );

  it('sem declarado vira octet-stream', () => {
    expect(sniffMediaType(texto)).toEqual({ mimeType: 'application/octet-stream', demuxer: null });
    expect(sniffMediaType(texto, null)).toEqual({ mimeType: 'application/octet-stream', demuxer: null });
  });

  it.each(['application/vnd.ms-excel', 'image/svg+xml', 'application/x-rar-compressed', 'application/vnd.oasis.opendocument.text'])(
    'declarado com subtipo normal %s continua aceito',
    (declarado) => {
      expect(sniffMediaType(texto, declarado)).toEqual({ mimeType: declarado, demuxer: null });
    },
  );

  it('mídia declarada sem assinatura nunca ganha demuxer', () => {
    expect(sniffMediaType(texto, 'video/mp4')).toEqual({ mimeType: 'video/mp4', demuxer: null });
  });
});

describe('sniffMediaType — cabeçalho curto', () => {
  it('cabeçalho vazio não quebra', () => {
    expect(sniffMediaType(new Uint8Array(0))).toEqual({ mimeType: 'application/octet-stream', demuxer: null });
  });

  it('cabeçalho menor que 12 bytes não quebra', () => {
    for (let n = 0; n < 12; n++) {
      expect(() => sniffMediaType(ftyp('heic').subarray(0, n))).not.toThrow();
      expect(() => sniffMediaType(bytes('RIFF', [0x24, 0, 0, 0], 'WEBP').subarray(0, n))).not.toThrow();
    }
  });

  it('assinatura incompleta não é reconhecida', () => {
    expect(sniffMediaType(bytes([0x89, 0x50, 0x4e, 0x47]), 'image/png')).toEqual({
      mimeType: 'image/png',
      demuxer: null,
    });
    expect(sniffMediaType(bytes('RIFF', [0x24, 0, 0, 0], 'WE'))).toEqual({
      mimeType: 'application/octet-stream',
      demuxer: null,
    });
  });

  it('ftyp sem brand completa cai em MP4 genérico', () => {
    expect(sniffMediaType(ftyp('heic').subarray(0, 10))).toEqual({
      mimeType: 'video/mp4',
      demuxer: 'mov',
      generic: true,
      declaredMimeType: null,
    });
  });
});
