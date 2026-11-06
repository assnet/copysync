import type { PrismaClient } from '@prisma/client';
import type { IWatchedChannelSource } from '../domain/contracts/IWatchedChannelSource';

/** Grupos monitorados de config ligada cujo id é de canal/supergrupo (`-100…`). Filtra por tenant. */
export class PrismaWatchedChannelSource implements IWatchedChannelSource {
  constructor(private readonly prisma: PrismaClient) {}

  async listWatchedChannels(tenantId: string, sessionId: string, limit: number): Promise<string[]> {
    const rows = await this.prisma.monitoredGroup.findMany({
      where: { tenantId, sessionId, groupJid: { startsWith: '-100' }, config: { enabled: true } },
      select: { groupJid: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => r.groupJid);
  }
}
