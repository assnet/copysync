import type { ChatMessage } from './types';

/**
 * Mescla da lista de mensagens de uma conversa com o que chega do servidor (design §14). Funções
 * puras: o `ChatPage` só aplica o resultado com `setMessages` funcional.
 */

/** Texto otimista (`tmp-…`): só existe no painel até a resposta do envio trocá-lo pelo real. */
const isLocalOnly = (message: ChatMessage) => message.id.startsWith('tmp-');

/** `sending` do servidor não regride o status que a lista já recebeu pelo WS. */
function keepAdvancedStatus(incoming: ChatMessage, local: ChatMessage | undefined): ChatMessage {
  if (!local || incoming.status !== 'sending' || local.status === 'sending') return incoming;
  return { ...incoming, status: local.status };
}

/**
 * Página mais recente (GET de abertura ou resync) sobre a lista local. A janela do servidor
 * manda, mas o que é local, ausente dela e mais novo que a última dela fica: a mídia confirmada
 * e o texto enviado enquanto o GET estava em voo não somem. Local mais antiga sai — o histórico
 * volta pelo "carregar mais", sem buraco entre a lista velha e a página nova.
 */
export function mergeLatestMessages(local: ChatMessage[] | undefined, fetched: ChatMessage[]): ChatMessage[] {
  if (!local?.length) return fetched;
  const localById = new Map(local.map((m) => [m.id, m]));
  const fetchedIds = new Set(fetched.map((m) => m.id));
  const last = fetched.length ? Date.parse(fetched[fetched.length - 1].timestamp) : Number.NEGATIVE_INFINITY;
  const newer = local.filter(
    (m) => !fetchedIds.has(m.id) && (isLocalOnly(m) || Date.parse(m.timestamp) >= last),
  );
  const merged = fetched.map((m) => keepAdvancedStatus(m, localById.get(m.id)));
  return newer.length ? [...merged, ...newer] : merged;
}

/** Mensagem real do 202/200: troca no lugar se o GET já a trouxe, senão entra ao fim. */
export function upsertConfirmedMessage(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = list.findIndex((m) => m.id === message.id);
  if (index < 0) return [...list, message];
  const next = keepAdvancedStatus(message, list[index]);
  return list.map((m, i) => (i === index ? next : m));
}
