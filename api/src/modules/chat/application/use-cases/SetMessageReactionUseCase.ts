import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatConversationRepository } from '../../domain/contracts/IChatConversationRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IChatMessageReactionRepository } from '../../domain/contracts/IChatMessageReactionRepository';
import type { IMessagingEngine, ReactionTargetRef } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { IReactionSendThrottle } from '../contracts/IReactionSendThrottle';
import type { IReactionUpdatePublisher } from '../contracts/IReactionUpdatePublisher';
import { aggregateReactions, type ReactionSummary } from '../../domain/services/aggregateReactions';
import {
  ConflictError,
  NotFoundError,
  TooManyRequestsError,
  ValidationError,
} from '../../../../shared/errors/internal/ResourceErrors';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import { resolveConversationTarget, buildEngineMessageRef } from './resolveConversationTarget';

/** Identidade da nossa conta — a mesma que a ingestão usa para o eco e o celular do operador. */
const SELF_REACTOR_KEY = 'self';

/** Teto do emoji em bytes UTF-8 (sequências ZWJ longas cabem com folga). */
const MAX_EMOJI_BYTES = 64;

export interface SetMessageReactionInput {
  tenantId: string;
  messageId: string;
  /** null = remover a nossa reação. */
  emoji: string | null;
}

/** Agregado final da mensagem — mesmo shape do evento WS. */
export interface SetMessageReactionOutput {
  conversationId: string;
  messageId: string;
  reactionsRevision: string | null;
  reactions: ReactionSummary[];
}

/**
 * Reagir/remover reação pelo painel (design de reações, §7).
 *
 * Ordem importa: carrega → valida → pré-condições → resolve alvo → limite → engine → grava →
 * publica (se mudou) → devolve. Diferente do `SendMessageUseCase`, **não** grava sem enviar:
 * reação é gesto no WhatsApp; gravada sem envio, o painel mostraria algo que o contato nunca vê.
 */
export class SetMessageReactionUseCase {
  constructor(
    private readonly messageRepo: IChatMessageRepository,
    private readonly conversationRepo: IChatConversationRepository,
    private readonly contactRepo: IChatContactRepository,
    private readonly reactionRepo: IChatMessageReactionRepository,
    private readonly engine: IMessagingEngine | null,
    private readonly throttle: IReactionSendThrottle,
    private readonly publisher: IReactionUpdatePublisher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: SetMessageReactionInput): Promise<SetMessageReactionOutput> {
    const { tenantId, messageId, emoji } = input;

    // 1. Mensagem e conversa, sempre filtradas pelo tenant
    const message = await this.messageRepo.findById(messageId, tenantId);
    if (!message) throw new NotFoundError('Message', messageId);
    const conv = await this.conversationRepo.findById(message.conversationId, tenantId);
    if (!conv) throw new NotFoundError('Conversation', message.conversationId);

    // 2. Emoji
    if (emoji !== null) assertValidEmoji(emoji);

    // 3. Pré-condições de envio — sem fallback de "gravar sem enviar"
    if (!this.engine || !conv.sessionId) throw new SessionNotConnectedError(conv.sessionId ?? conv.id);
    const sessionId = conv.sessionId;
    if (!message.externalMessageId) throw new ConflictError('Message was never delivered to WhatsApp');
    if (message.isDeleted) throw new ConflictError('Cannot react to a deleted message');

    // 4. Alvo: só a identidade da mensagem (id, chat, autor)
    const contact = conv.isGroup ? null : await this.contactRepo.findById(conv.contactId ?? '', tenantId);
    const conversationTarget = resolveConversationTarget(conv, contact);
    const ref = buildEngineMessageRef(conversationTarget, message);
    if (!ref) throw new ConflictError('Message was never delivered to WhatsApp');

    const target: ReactionTargetRef = { externalId: ref.externalId, remoteJid: ref.remoteJid, fromMe: ref.fromMe };
    if (conversationTarget.isGroup && !ref.fromMe) {
      // Key de grupo sem participante é aceita e ignorada pelo WhatsApp: falha aqui, não lá.
      if (!message.fromParticipant) throw new ConflictError('Group message without participant');
      target.participant = message.fromParticipant;
    }

    // 5. Limite de envio — vaga reservada de forma síncrona
    const reservation = this.throttle.tryAcquire(sessionId, message.id);
    if (!reservation) throw new TooManyRequestsError('Too many reactions — try again shortly');

    // 6. Envia primeiro; falhou → devolve a vaga e não grava nada
    const reactedAt = this.now();
    try {
      await this.engine.sendReaction({ sessionId, tenantId, target, emoji, reactedAt });
    } catch (err) {
      this.throttle.release(reservation);
      throw err;
    }

    // 7. Grava com o mesmo carimbo enviado
    const result = await this.reactionRepo.apply({
      tenantId,
      messageId: message.id,
      reactorKey: SELF_REACTOR_KEY,
      emoji,
      reactorPhone: null,
      reactorName: null,
      fromMe: true,
      externalId: null,
      reactedAt,
    });

    // 9. Agregado lido depois do apply (devolvido mesmo sem publicar)
    const rows = await this.reactionRepo.findByMessageId(message.id, tenantId);
    const phones = [...new Set(rows.map((r) => r.reactorPhone).filter((p): p is string => !!p))];
    const contacts = phones.length ? await this.contactRepo.findByPhones(phones, tenantId) : [];
    const aggregate = aggregateReactions(rows, new Map(contacts.map((c) => [c.phone, c])));

    const output: SetMessageReactionOutput = {
      conversationId: conv.id,
      messageId: message.id,
      reactionsRevision: aggregate.revision,
      reactions: aggregate.reactions,
    };

    // 8. Publica só se o estado visível mudou — o eco pode ter chegado antes e já publicado
    if (result.changed) this.publisher.publishReactionUpdated({ tenantId, ...output });

    return output;
  }
}

/**
 * Validação por forma, não por lista de emojis: não vazio, ≤ 64 bytes, não só ASCII, sem
 * whitespace (`\s`, `\p{Z}`) nem controle (`\p{Cc}`). Nunca `\p{C}`: ele inclui `Cf` e
 * rejeitaria ZWJ (U+200D) e as tag sequences de bandeira. Keycap `1️⃣` contém ASCII e é válido.
 */
function assertValidEmoji(emoji: string): void {
  const valid =
    emoji.length > 0 &&
    new TextEncoder().encode(emoji).length <= MAX_EMOJI_BYTES &&
    !/^[\x00-\x7F]*$/.test(emoji) &&
    !/[\s\p{Z}\p{Cc}]/u.test(emoji);
  if (!valid) throw new ValidationError('Invalid reaction emoji', { emoji });
}
