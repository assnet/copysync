import type { PrismaClient } from '@prisma/client';
import type { IOfferWatermarkRepository, OfferWatermarkPatch } from '../../domain/contracts/IOfferWatermarkRepository';
import type { OfferWatermark } from '../../domain/entities/OfferWatermark';
import { PrismaOfferWatermarkMapper } from '../mappers/PrismaOfferWatermarkMapper';

/** Marca d'água do tenant (1 por tenant, `tenantId` único): tudo filtra `tenantId`. */
export class PrismaOfferWatermarkRepository implements IOfferWatermarkRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByTenant(tenantId: string): Promise<OfferWatermark | null> {
    const row = await this.prisma.offerWatermark.findUnique({ where: { tenantId } });
    return row ? PrismaOfferWatermarkMapper.toDomain(row) : null;
  }

  /** Um só upsert: campo `undefined` não entra no `update` (Prisma ignora), então trocar `kind` preserva o resto. */
  async save(tenantId: string, patch: OfferWatermarkPatch): Promise<OfferWatermark> {
    const data = {
      kind: patch.kind,
      imageKey: patch.imageKey,
      text: patch.text,
      enabled: patch.enabled,
      position: patch.position,
      size: patch.size,
      opacity: patch.opacity,
    };
    const row = await this.prisma.offerWatermark.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
    return PrismaOfferWatermarkMapper.toDomain(row);
  }
}
