import type { PrismaClient } from '@prisma/client';
import type { IOfferHunterSettingsRepository } from '../../../domain/contracts/hunter/IOfferHunterSettingsRepository';
import type { OfferHunterSettings } from '../../../domain/hunter/OfferHunt';
import { PrismaOfferHuntMapper as Mapper } from '../../mappers/PrismaOfferHuntMapper';

export class PrismaOfferHunterSettingsRepository implements IOfferHunterSettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(tenantId: string): Promise<OfferHunterSettings | null> {
    const raw = await this.prisma.offerHunterSettings.findUnique({ where: { tenantId } });
    return raw ? Mapper.settingsToDomain(raw) : null;
  }

  async upsert(tenantId: string, sessionId: string, conversationId: string): Promise<OfferHunterSettings> {
    const raw = await this.prisma.offerHunterSettings.upsert({
      where: { tenantId },
      create: { tenantId, sessionId, conversationId },
      update: { sessionId, conversationId },
    });
    return Mapper.settingsToDomain(raw);
  }
}
