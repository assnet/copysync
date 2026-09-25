import type { IChatMessageRepository } from '../../domain/contracts/IChatMessageRepository';
import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IChatMessageReactionRepository } from '../../domain/contracts/IChatMessageReactionRepository';
import { aggregateReactions, type ReactionSummary } from '../../domain/services/aggregateReactions';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'IngestMessageReactionUseCase' });

/** Identidade da nossa conta — a mesma que o painel grava ao reagir. */
const SELF_REACTOR_KEY = 'self';

/**
 * Reação vinda do WhatsApp, já normalizada pelo adapter. DTO próprio da aplicação: o use case
 * não conhece o evento interno de mensageria nem o payload da engine.
 */
export interface IngestMessageReactionInput {
  tenantId: string;
  sessionId: string;
  /** Id externo da mensagem reagida. */
  targetExternalMessageId: string;
  /** null = remoção. */
  emoji: string | null;
  reactorKey: string;
  reactorPhone: string | null;
  reactorName: string | null;
  fromMe: boolean;
  /** true = eco do envio feito pelo painel (carimbo já fixado pelo servidor). */
  isEcho: boolean;
  reactionExternalId: string | null;
  /** Carimbo do evento (senderTimestampMs convertido pelo adapter). */
  reactedAt: Date;
}

/** Agregado a publicar pelo listener. */
export interface IngestMessageReactionOutput {
  conversationId: string;
  messageId: string;
  reactionsRevision: string | null;
  reactions: ReactionSummary[];
}

/**
 * Ingestão de reação recebida. Só escreve na tabela de reações: nunca toca a conversa
 * (prévia, `lastMessageAt`, não lidas, status, arquivamento) — design §7.1. Por isso nem
 * depende do repositório de conversa.
 */
export class IngestMessageReactionUseCase {
  constructor(
    private readonly messageRepo: IChatMessageRepository,
    private readonly reactionRepo: IChatMessageReactionRepository,
    private readonly contactRepo: IChatContactRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: IngestMessageReactionInput): Promise<IngestMessageReactionOutput | null> {
    const target = await this.messageRepo.findByExternalId(input.targetExternalMessageId, input.tenantId);
    if (!target) {
      // Reação a mensagem que não temos (anterior ao sync, ou de outra sessão): ignora.
      log.debug(
        { tenantId: input.tenantId, sessionId: input.sessionId, target: input.targetExternalMessageId },
        'Reaction target not found — skipping',
      );
      return null;
    }

    const result = await this.reactionRepo.apply({
      tenantId: input.tenantId,
      messageId: target.id,
      reactorKey: input.fromMe ? SELF_REACTOR_KEY : input.reactorKey,
      emoji: input.emoji,
      reactorPhone: input.reactorPhone,
      reactorName: input.reactorName,
      fromMe: input.fromMe,
      externalId: input.reactionExternalId,
      reactedAt: this.stampFor(input),
    });
    // Evento velho, eco repetido ou sem mudança visível: nada a publicar.
    if (!result.changed) return null;

    const rows = await this.reactionRepo.findByMessageId(target.id, input.tenantId);
    const phones = [...new Set(rows.map((r) => r.reactorPhone).filter((p): p is string => !!p))];
    const contacts = phones.length
      ? await this.contactRepo.findByPhones(phones, input.tenantId)
      : [];
    const aggregate = aggregateReactions(rows, new Map(contacts.map((c) => [c.phone, c])));

    return {
      conversationId: target.conversationId,
      messageId: target.id,
      reactionsRevision: aggregate.revision,
      reactions: aggregate.reactions,
    };
  }

  /**
   * Relógio do carimbo (design §4): cada autor compara carimbos de um relógio só.
   * - eco do painel → carimbo que o servidor fixou antes de enviar
   * - celular do operador → `now` do servidor (o relógio do aparelho pode estar atrasado)
   * - terceiros → carimbo do evento
   */
  private stampFor(input: IngestMessageReactionInput): Date {
    if (input.fromMe && !input.isEcho) return this.now();
    return input.reactedAt;
  }
}
