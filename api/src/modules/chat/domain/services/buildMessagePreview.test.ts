import { describe, it, expect } from 'vitest';
import { ChatMessageType } from '../enums/ChatMessageEnums';
import { buildMessagePreview } from './buildMessagePreview';

describe('buildMessagePreview', () => {
  it('usa o texto da mensagem quando cabe na prévia', () => {
    expect(buildMessagePreview(ChatMessageType.TEXT, 'Oi, tudo bem?')).toBe('Oi, tudo bem?');
  });

  it('prefere a legenda ao rótulo quando a mídia tem texto', () => {
    expect(buildMessagePreview(ChatMessageType.IMAGE, 'Foto da fachada')).toBe('Foto da fachada');
  });

  it('mantém intacto o texto com exatamente 100 caracteres', () => {
    const texto = 'a'.repeat(100);
    expect(buildMessagePreview(ChatMessageType.TEXT, texto)).toBe(texto);
  });

  it('corta o texto acima de 100 caracteres em 97 e acrescenta reticências', () => {
    const texto = 'b'.repeat(97) + 'cdef';
    const previa = buildMessagePreview(ChatMessageType.TEXT, texto);
    expect(previa).toBe('b'.repeat(97) + '…');
    expect(previa).toHaveLength(98);
  });

  it.each([
    [ChatMessageType.IMAGE, '📷 Imagem'],
    [ChatMessageType.AUDIO, '🎵 Áudio'],
    [ChatMessageType.VIDEO, '🎥 Vídeo'],
    [ChatMessageType.DOCUMENT, '📄 Documento'],
    [ChatMessageType.STICKER, '😊 Sticker'],
    [ChatMessageType.LOCATION, '📍 Localização'],
    [ChatMessageType.VCARD, '👤 Contato'],
    [ChatMessageType.CALL_LOG, '📞 Chamada'],
  ])('sem texto, %s mostra o rótulo "%s"', (tipo, rotulo) => {
    expect(buildMessagePreview(tipo, null)).toBe(rotulo);
  });

  it('trata texto vazio como ausência de texto', () => {
    expect(buildMessagePreview(ChatMessageType.DOCUMENT, '')).toBe('📄 Documento');
  });

  it.each([ChatMessageType.TEXT, ChatMessageType.EVENT])(
    'sem texto e sem rótulo próprio, %s cai em "📎 Mídia"',
    (tipo) => {
      expect(buildMessagePreview(tipo, null)).toBe('📎 Mídia');
    },
  );
});
