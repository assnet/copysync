import type { PrismaClient } from '@prisma/client';
import type { ILinkRotationJobLease } from '../../domain/contracts/ILinkRotationJobLease';

/**
 * Lease em `job_leases` (tabela do `billing-reconcile`). Um único upsert condicional: sem
 * corrida entre update e create e sem exceção (nem log `prisma:error`) quando outro é dono —
 * o job tenta a cada 60 s e o lease de retenção fica ocupado por 1 h.
 */
export class PrismaLinkRotationJobLease implements ILinkRotationJobLease {
  constructor(private readonly prisma: PrismaClient) {}

  async tryAcquire(name: string, ownerId: string, until: Date, now: Date): Promise<boolean> {
    const count = await this.prisma.$executeRaw`
      INSERT INTO "job_leases" ("name", "ownerId", "expiresAt") VALUES (${name}, ${ownerId}, ${until})
      ON CONFLICT ("name") DO UPDATE SET "ownerId" = EXCLUDED."ownerId", "expiresAt" = EXCLUDED."expiresAt"
      WHERE "job_leases"."expiresAt" < ${now}`;
    return count > 0;
  }

  async release(name: string, ownerId: string): Promise<void> {
    await this.prisma.jobLease.deleteMany({ where: { name, ownerId } });
  }
}
