import type { PrismaClient } from '@prisma/client';
import type { SaverExportGrant } from '../../domain/entities/SaverEntities';
import type { ISaverExportGrantRepository } from '../../domain/contracts/ISaverExportGrantRepository';
import { PrismaSaverMapper } from '../mappers/PrismaSaverMapper';

/**
 * Liberação individual de exportar. FK composta para `user_tenants (userId, tenantId)`: alvo fora do
 * tenant falha no banco e sair do tenant apaga a liberação. Ligar duas vezes = 1 linha.
 */
export class PrismaSaverExportGrantRepository implements ISaverExportGrantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async hasGrant(tenantId: string, userId: string): Promise<boolean> {
    return (await this.prisma.saverExportGrant.count({ where: { tenantId, userId } })) > 0;
  }

  async listByTenant(tenantId: string): Promise<SaverExportGrant[]> {
    const rows = await this.prisma.saverExportGrant.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
    return rows.map(PrismaSaverMapper.grant);
  }

  async grant(tenantId: string, userId: string, grantedByUserId: string): Promise<void> {
    await this.prisma.saverExportGrant.createMany({ data: [{ tenantId, userId, grantedByUserId }], skipDuplicates: true });
  }

  async revoke(tenantId: string, userId: string): Promise<void> {
    await this.prisma.saverExportGrant.deleteMany({ where: { tenantId, userId } });
  }
}
