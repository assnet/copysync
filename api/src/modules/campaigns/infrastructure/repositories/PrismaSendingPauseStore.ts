import type { PrismaClient } from '@prisma/client';
import type { ISendingPauseStore } from '../../domain/contracts/ISendingPauseStore';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';

/** `tenants.sendingPausedAt` (o claim do worker lê a mesma coluna em SQL). */
export class PrismaSendingPauseStore implements ISendingPauseStore {
  constructor(private readonly prisma: PrismaClient) {}

  async get(tenantId: string): Promise<Date | null> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { sendingPausedAt: true } });
    return t?.sendingPausedAt ?? null;
  }

  /** Um só UPDATE … RETURNING: o valor devolvido é o gravado (sem janela entre gravar e ler). */
  async pauseIfActive(tenantId: string, at: Date): Promise<Date> {
    const rows = await this.prisma.$queryRaw<{ sendingPausedAt: Date }[]>`
      UPDATE "tenants" SET "sendingPausedAt" = COALESCE("sendingPausedAt", ${at})
       WHERE "id" = ${tenantId} RETURNING "sendingPausedAt"`;
    if (rows.length === 0) throw new NotFoundError('Tenant', tenantId);
    return rows[0]!.sendingPausedAt;
  }

  async set(tenantId: string, pausedAt: Date | null): Promise<void> {
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { sendingPausedAt: pausedAt } });
  }
}
