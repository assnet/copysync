/**
 * Conteúdo das mensagens que esta engine enviou, por sessão e id, por tempo limitado.
 *
 * Em grupo, um aparelho que não conseguiu decifrar a nossa mídia pede reenvio; o Baileys
 * busca o conteúdo pelo `getMessage` do socket. Sem ele, o destinatário fica em
 * "Aguardando esta mensagem".
 *
 * Regras:
 * - `get` não retira: o mesmo id pode ser pedido por vários aparelhos
 * - TTL e teto por sessão; teto cheio descarta o mais antigo
 *
 * O conteúdo é opaco (genérico): a classe não conhece o tipo da engine. Classe pura, relógio
 * injetável. A instância usada pelo adapter é de módulo — ver `sentMediaCache()`.
 */
import type { proto } from '@whiskeysockets/baileys';
import { env } from '../../../../../shared/config/env';

export interface SentMessageCacheOptions {
  ttlMs: number;
  maxPerSession: number;
  now?: () => number;
}

interface CachedMessage<T> {
  message: T;
  expiresAt: number;
}

export class SentMessageCache<T> {
  /** sessionId → (messageId → conteúdo). Map preserva a ordem de inserção: o primeiro é o mais antigo. */
  private readonly sessions = new Map<string, Map<string, CachedMessage<T>>>();
  private readonly now: () => number;

  constructor(private readonly options: SentMessageCacheOptions) {
    this.now = options.now ?? Date.now;
  }

  set(sessionId: string, messageId: string, message: T): void {
    let messages = this.sessions.get(sessionId);
    if (!messages) {
      messages = new Map();
      this.sessions.set(sessionId, messages);
    }
    messages.delete(messageId);

    if (messages.size >= this.options.maxPerSession) {
      messages.delete(messages.keys().next().value as string);
    }

    messages.set(messageId, { message, expiresAt: this.now() + this.options.ttlMs });
  }

  get(sessionId: string, messageId: string): T | undefined {
    const messages = this.sessions.get(sessionId);
    const cached = messages?.get(messageId);
    if (!messages || !cached) return undefined;

    if (cached.expiresAt < this.now()) {
      messages.delete(messageId);
      if (messages.size === 0) this.sessions.delete(sessionId);
      return undefined;
    }
    return cached.message;
  }
}

let cache: SentMessageCache<proto.IMessage> | null = null;

/**
 * Único por processo: há dois adapters (bootstrap e rotas) e o `getMessage` fica preso ao
 * que abriu o socket, que pode não ser o que enviou. TTL e teto são os do eco de mídia.
 */
export function sentMediaCache(): SentMessageCache<proto.IMessage> {
  cache ??= new SentMessageCache({
    ttlMs: env.MEDIA_ECHO_TTL_MS,
    maxPerSession: env.MEDIA_ECHO_MAX_PER_SESSION,
  });
  return cache;
}
