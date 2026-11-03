import { describe, expect, it } from 'vitest';
import {
  LINK_PREVIEW_DESCRIPTION_MAX,
  LINK_PREVIEW_INLINE_THUMB_MAX_BYTES,
  LINK_PREVIEW_TITLE_MAX,
  pickInboundLinkPreview,
} from './pickInboundLinkPreview';

const jpeg = (size = 10) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff]);
  return b;
};

const base = { text: 'Veja https://loja.com/p', matchedText: 'https://loja.com/p', title: 'Produto' };

describe('pickInboundLinkPreview', () => {
  it('mensagem completa', () => {
    const key = new Uint8Array([1, 2, 3]);
    const out = pickInboundLinkPreview({
      ...base, description: 'Desc', jpegThumbnail: jpeg(), thumbnailDirectPath: '/v/t62/x', mediaKey: key,
    });
    expect(out).toMatchObject({ url: 'https://loja.com/p', title: 'Produto', description: 'Desc', hq: { directPath: '/v/t62/x', mediaKey: key } });
    expect(Buffer.isBuffer(out!.inlineThumb)).toBe(true);
    expect(out!.inlineThumb!.length).toBe(10);
  });

  it('sem mensagem, sem matchedText ou só título → null', () => {
    expect(pickInboundLinkPreview(null)).toBeNull();
    expect(pickInboundLinkPreview(undefined)).toBeNull();
    expect(pickInboundLinkPreview({ text: 'oi' })).toBeNull();
    expect(pickInboundLinkPreview({ text: 'oi', title: 'Só título' })).toBeNull();
    expect(pickInboundLinkPreview({ matchedText: '   ' })).toBeNull();
  });

  it('url sem título: cartão só com url', () => {
    expect(pickInboundLinkPreview({ matchedText: 'https://loja.com' })).toEqual({
      url: 'https://loja.com/', title: null, description: null, inlineThumb: null, hq: null,
    });
  });

  it('só http/https', () => {
    expect(pickInboundLinkPreview({ ...base, matchedText: 'http://loja.com/a' })!.url).toBe('http://loja.com/a');
    for (const bad of ['ftp://loja.com/a', 'javascript:alert(1)', 'mailto:a@b.com', 'data:text/html,x', 'file:///etc/passwd', 'tel:+5511999']) {
      expect(pickInboundLinkPreview({ ...base, matchedText: bad }), bad).toBeNull();
    }
  });

  it('sem esquema recebe https://', () => {
    expect(pickInboundLinkPreview({ ...base, matchedText: 'www.loja.com/p' })!.url).toBe('https://www.loja.com/p');
    expect(pickInboundLinkPreview({ ...base, matchedText: 'amzn.to/x' })!.url).toBe('https://amzn.to/x');
  });

  it('host sem ponto, credenciais, inválida ou longa demais → null', () => {
    expect(pickInboundLinkPreview({ ...base, matchedText: 'https://localhost/a' })).toBeNull();
    expect(pickInboundLinkPreview({ ...base, matchedText: 'https://user:pw@loja.com/' })).toBeNull();
    expect(pickInboundLinkPreview({ ...base, matchedText: 'https://' })).toBeNull();
    expect(pickInboundLinkPreview({ ...base, matchedText: `https://loja.com/${'a'.repeat(2048)}` })).toBeNull();
  });

  it('corta título e descrição; vazio vira null', () => {
    const out = pickInboundLinkPreview({ ...base, title: 't'.repeat(400), description: 'd'.repeat(600) })!;
    expect(out.title).toHaveLength(LINK_PREVIEW_TITLE_MAX);
    expect(out.description).toHaveLength(LINK_PREVIEW_DESCRIPTION_MAX);
    expect(pickInboundLinkPreview({ ...base, title: '  ', description: '' })).toMatchObject({ title: null, description: null });
  });

  it('corte não parte emoji ao meio', () => {
    const out = pickInboundLinkPreview({ ...base, title: '🔥'.repeat(301) })!;
    expect(Array.from(out.title!)).toHaveLength(LINK_PREVIEW_TITLE_MAX);
    expect(out.title!.endsWith('🔥')).toBe(true);
  });

  it('miniatura: só JPEG e até 100 KB', () => {
    expect(pickInboundLinkPreview({ ...base, jpegThumbnail: jpeg(LINK_PREVIEW_INLINE_THUMB_MAX_BYTES) })!.inlineThumb).not.toBeNull();
    expect(pickInboundLinkPreview({ ...base, jpegThumbnail: jpeg(LINK_PREVIEW_INLINE_THUMB_MAX_BYTES + 1) })!.inlineThumb).toBeNull();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]);
    expect(pickInboundLinkPreview({ ...base, jpegThumbnail: png })!.inlineThumb).toBeNull();
    expect(pickInboundLinkPreview({ ...base, jpegThumbnail: new Uint8Array([0xff, 0xd8]) })!.inlineThumb).toBeNull();
    expect(pickInboundLinkPreview({ ...base, jpegThumbnail: new Uint8Array() })!.inlineThumb).toBeNull();
  });

  it('hq só com directPath e mediaKey', () => {
    const key = new Uint8Array([9]);
    expect(pickInboundLinkPreview({ ...base, thumbnailDirectPath: '/v/x' })!.hq).toBeNull();
    expect(pickInboundLinkPreview({ ...base, mediaKey: key })!.hq).toBeNull();
    expect(pickInboundLinkPreview({ ...base, thumbnailDirectPath: '/v/x', mediaKey: new Uint8Array() })!.hq).toBeNull();
    expect(pickInboundLinkPreview({ ...base, thumbnailDirectPath: ' ', mediaKey: key })!.hq).toBeNull();
    expect(pickInboundLinkPreview({ ...base, thumbnailDirectPath: '/v/x', mediaKey: key })!.hq).toEqual({ directPath: '/v/x', mediaKey: key });
  });
});
