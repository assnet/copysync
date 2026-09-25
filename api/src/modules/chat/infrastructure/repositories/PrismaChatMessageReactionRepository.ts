import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  ApplyReactionInput,
  ApplyReactionResult,
  IChatMessageReactionRepository,
} from '../../domain/contracts/IChatMessageReactionRepository';
import type { ChatMessageReaction } from '../../domain/entities/ChatMessageReaction';
import { decideReactionWrite } from '../../domain/services/decideReactionWrite';
import { InfrastructureError } from '../../../../shared/errors/InfrastructureError';
import { EngineTemporarilyUnavailableError } from '../../../../shared/errors/internal/MessagingErrors';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { PrismaChatMessageReactionMapper } from '../mappers/PrismaChatMessageReactionMapper';

/**
 * Códigos transitórios: transação expirada (P2028), pool esgotado (P2024) e conexão
 * caída/recusada (P1001, P1002, P1008, P1017). Repetir mais tarde resolve — viram 503.
 */
const TRANSIENT_CODES = new Set(['P2028', 'P2024', 'P1001', 'P1002', 'P1008', 'P1017']);

export class PrismaChatMessageReactionRepository implements IChatMessageReactionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async apply(input: ApplyReactionInput): Promise<ApplyReactionResult> {
    const { tenantId, messageId, reactorKey } = input;

    return this.translate(() =>
      this.prisma.$transaction(
        async (tx) => {
          // Serializa só o par (mensagem, autor); o lock de transação some no commit/rollback.
          // Casts obrigatórios: sem eles o bind chega sem tipo e `hashtextextended` não resolve.
          // `$executeRaw` porque a função devolve `void`, que o `$queryRaw` não desserializa.
          const lockKey = `${messageId}:${reactorKey}`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}::text, 0::bigint))`;

          // Busca pela chave única, sem tenantId: uma linha de outro tenant precisa ser vista
          // para ser recusada — filtrá-la faria o upsert colidir na unique.
          const current = await tx.chatMessageReaction.findUnique({
            where: { messageId_reactorKey: { messageId, reactorKey } },
          });

          // Defesa multi-tenant: nunca sobrescreve linha alheia. 404 em vez de 409 para não
          // confirmar que a mensagem existe em outro tenant.
          if (current && current.tenantId !== tenantId) {
            throw new NotFoundError('ChatMessage', messageId);
          }

          const decision = decideReactionWrite(
            current && PrismaChatMessageReactionMapper.toDomain(current),
            input,
          );

          if (decision.applied) {
            const fields = {
              emoji: input.emoji,
              reactorPhone: input.reactorPhone,
              reactorName: input.reactorName,
              fromMe: input.fromMe,
              externalId: input.externalId,
              reactedAt: input.reactedAt,
            };
            // Remoção grava `emoji = null` (tombstone), nunca DELETE: o carimbo precisa ficar.
            await tx.chatMessageReaction.upsert({
              where: { messageId_reactorKey: { messageId, reactorKey } },
              create: { id: randomUUID(), tenantId, messageId, reactorKey, ...fields },
              update: fields,
            });
          }

          return decision;
        },
        { maxWait: 2_000, timeout: 5_000 },
      ),
    );
  }

  async findByMessageId(messageId: string, tenantId: string): Promise<ChatMessageReaction[]> {
    const rows = await this.translate(() =>
      this.prisma.chatMessageReaction.findMany({ where: { messageId, tenantId } }),
    );
    return rows.map(PrismaChatMessageReactionMapper.toDomain);
  }

  async findByMessageIds(messageIds: string[], tenantId: string): Promise<ChatMessageReaction[]> {
    if (messageIds.length === 0) return [];

    const rows = await this.translate(() =>
      this.prisma.chatMessageReaction.findMany({
        where: { tenantId, messageId: { in: messageIds } },
      }),
    );
    return rows.map(PrismaChatMessageReactionMapper.toDomain);
  }

  /** Nenhum erro cru do Prisma sobe (AGENTS.md §13); erros internos passam intactos. */
  private async translate<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientInitializationError ||
        error instanceof Prisma.PrismaClientRustPanicError ||
        (error instanceof Prisma.PrismaClientKnownRequestError && TRANSIENT_CODES.has(error.code))
      ) {
        throw new EngineTemporarilyUnavailableError();
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        // FK da mensagem: ela foi apagada entre a resolução e a escrita.
        throw new NotFoundError('ChatMessage');
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientValidationError
      ) {
        throw new InfrastructureError('REACTION_PERSISTENCE_FAILED', 'Reaction persistence failed', {
          prismaCode: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined,
        });
      }
      throw error;
    }
  }
}
