/** Canal gravado em `ChatConversation.channel`. Decidido pela engine da sessão. */
export type ConversationChannel = 'whatsapp' | 'telegram';

/** `telegram` só para sessão da engine `telegram`; o resto (Baileys, sessão sem engine conhecida) é WhatsApp. */
export function channelForEngine(engine: string | null | undefined): ConversationChannel {
  return engine === 'telegram' ? 'telegram' : 'whatsapp';
}
