import type { PrismaClient } from '@prisma/client';
import type {
  IOfferHuntAiSuggestionCounter, OfferHuntAiSuggestionClaim,
} from '../../../domain/contracts/hunter/IOfferHuntAiSuggestionCounter';

/**
 * Teto de sugestões de IA da caçada: lock consultivo por tenant na transação, conta o dia e grava a reserva.
 * Duas requisições simultâneas no limite: a 2ª espera o lock e já vê a linha da 1ª.
 */
export class PrismaOfferHuntAiSuggestionCounter implements IOfferHuntAiSuggestionCounter {
  constructor(private readonly prisma: PrismaClient) {}

  async claim(tenantId: string, dayStart: Date, dailyMax: number, now: Date): Promise<OfferHuntAiSuggestionClaim> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`offer-hunt-ai-suggest:${tenantId}`}))`;
      const used = await tx.offerHuntAiSuggestion.count({ where: { tenantId, createdAt: { gte: dayStart } } });
      if (used >= dailyMax) return { kind: 'DAILY_LIMIT', used };
      const row = await tx.offerHuntAiSuggestion.create({ data: { tenantId, createdAt: now }, select: { id: true } });
      return { kind: 'OK', id: row.id, used: used + 1 };
    });
  }

  async release(tenantId: string, id: string): Promise<void> {
    await this.prisma.offerHuntAiSuggestion.deleteMany({ where: { id, tenantId } });
  }

  countSince(tenantId: string, dayStart: Date): Promise<number> {
    return this.prisma.offerHuntAiSuggestion.count({ where: { tenantId, createdAt: { gte: dayStart } } });
  }
}
