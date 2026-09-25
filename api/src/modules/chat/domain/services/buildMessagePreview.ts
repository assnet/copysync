import { ChatMessageType } from '../enums/ChatMessageEnums';

/** Rótulo da prévia quando a mensagem não tem texto; tipo sem rótulo cai em `📎 Mídia`. */
const LABELS: Partial<Record<ChatMessageType, string>> = {
  [ChatMessageType.IMAGE]:    '📷 Imagem',
  [ChatMessageType.AUDIO]:    '🎵 Áudio',
  [ChatMessageType.VIDEO]:    '🎥 Vídeo',
  [ChatMessageType.DOCUMENT]: '📄 Documento',
  [ChatMessageType.STICKER]:  '😊 Sticker',
  [ChatMessageType.LOCATION]: '📍 Localização',
  [ChatMessageType.VCARD]:    '👤 Contato',
  [ChatMessageType.CALL_LOG]: '📞 Chamada',
};

/**
 * Prévia da última mensagem exibida na lista de conversas.
 *
 * Texto (ou legenda) vence o rótulo; acima de 100 caracteres corta em 97 e acrescenta `…`.
 * Sem texto, usa o rótulo do tipo.
 */
export function buildMessagePreview(type: ChatMessageType, body: string | null): string {
  if (body) return body.length > 100 ? body.slice(0, 97) + '…' : body;
  return LABELS[type] ?? '📎 Mídia';
}
