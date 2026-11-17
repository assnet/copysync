import type { PrismaClient } from '@prisma/client';
import type { SaverGroup } from '../../domain/entities/SaverEntities';
import type {
  ISaverGroupRepository,
  SaverGroupScanInput,
  SaverGroupUpsertInput,
} from '../../domain/contracts/ISaverGroupRepository';
import { PrismaSaverMapper } from '../mappers/PrismaSaverMapper';

/** Grupos salvos do tenant. Toda consulta e escrita filtra `tenantId`; remover é lógico (nunca `DELETE`). */
export class PrismaSaverGroupRepository implements ISaverGroupRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listActive(tenantId: string): Promise<SaverGroup[]> {
    const rows = await this.prisma.saverGroup.findMany({
      where: { tenantId, removedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(PrismaSaverMapper.group);
  }

  async findById(tenantId: string, groupId: string): Promise<SaverGroup | null> {
    const row = await this.prisma.saverGroup.findFirst({ where: { id: groupId, tenantId } });
    return row ? PrismaSaverMapper.group(row) : null;
  }

  async findByJids(tenantId: string, groupJids: readonly string[]): Promise<SaverGroup[]> {
    if (groupJids.length === 0) return [];
    const rows = await this.prisma.saverGroup.findMany({ where: { tenantId, groupJid: { in: [...groupJids] } } });
    return rows.map(PrismaSaverMapper.group);
  }

  countActive(tenantId: string): Promise<number> {
    return this.prisma.saverGroup.count({ where: { tenantId, removedAt: null } });
  }

  async markRemoved(tenantId: string, groupId: string, at: Date): Promise<void> {
    await this.prisma.saverGroup.updateMany({ where: { id: groupId, tenantId, removedAt: null }, data: { removedAt: at } });
  }

  async upsertMany(tenantId: string, sessionId: string, groups: readonly SaverGroupUpsertInput[]): Promise<SaverGroup[]> {
    if (groups.length === 0) return [];
    const rows = await this.prisma.$transaction(
      groups.map((g) =>
        this.prisma.saverGroup.upsert({
          where: { tenantId_groupJid: { tenantId, groupJid: g.groupJid } },
          create: { tenantId, sessionId, groupJid: g.groupJid, name: g.name },
          update: { sessionId, name: g.name, removedAt: null },
        }),
      ),
    );
    return rows.map(PrismaSaverMapper.group);
  }

  async recordScan(tenantId: string, groupId: string, scan: SaverGroupScanInput): Promise<void> {
    await this.prisma.saverGroup.updateMany({
      where: { id: groupId, tenantId, removedAt: null },
      data: {
        sessionId: scan.sessionId,
        lastScannedAt: scan.at,
        lastScanStatus: scan.status,
        ...(scan.memberCount !== undefined ? { memberCount: scan.memberCount } : {}),
        ...(scan.phoneCount !== undefined ? { phoneCount: scan.phoneCount } : {}),
        ...(scan.lidOnlyCount !== undefined ? { lidOnlyCount: scan.lidOnlyCount } : {}),
      },
    });
  }
}
