import type { PrismaClient } from '@prisma/client';
import type { SaverConfig } from '../../domain/entities/SaverEntities';
import type { ISaverConfigRepository, SaverConfigUpdate } from '../../domain/contracts/ISaverConfigRepository';
import { PrismaSaverMapper } from '../mappers/PrismaSaverMapper';

/** Configuração do Saver por tenant (chave = `tenantId`). Sem linha = `null`: o use case aplica os padrões. */
export class PrismaSaverConfigRepository implements ISaverConfigRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByTenant(tenantId: string): Promise<SaverConfig | null> {
    const row = await this.prisma.saverConfig.findUnique({ where: { tenantId } });
    return row ? PrismaSaverMapper.config(row) : null;
  }

  async upsert(tenantId: string, update: SaverConfigUpdate): Promise<SaverConfig> {
    const row = await this.prisma.saverConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...update },
      update,
    });
    return PrismaSaverMapper.config(row);
  }
}
