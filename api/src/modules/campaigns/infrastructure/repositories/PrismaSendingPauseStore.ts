import type { PrismaClient } from '@prisma/client';
import type { ISendingPauseStore } from '../../domain/contracts/ISendingPauseStore';

/** `tenants.sendingPausedAt` (o claim do worker lê a mesma coluna em SQL). */
export class PrismaSendingPauseStore implements ISendingPauseStore {
  constructor(private readonly prisma: PrismaClient) {}

  async get(tenantId: string): Promise<Date | null> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { sendingPausedAt: true } });
    return t?.sendingPausedAt ?? null;
  }

  async pauseIfActive(tenantId: string, at: Date): Promise<Date> {
    await this.prisma.tenant.updateMany({ where: { id: tenantId, sendingPausedAt: null }, data: { sendingPausedAt: at } });
    return (await this.get(tenantId)) ?? at;
  }

  async set(tenantId: string, pausedAt: Date | null): Promise<void> {
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { sendingPausedAt: pausedAt } });
  }
}
