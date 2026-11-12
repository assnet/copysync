import type { PrismaClient } from '@prisma/client';
import type { IJobLease, IJobLeaseSweep } from '../../jobs/IJobLease';

/**
 * Lease em `job_leases` (tabela do `billing-reconcile`). Um único upsert condicional: sem
 * corrida entre update e create e sem exceção (nem log `prisma:error`) quando outro é dono —
 * o job tenta a cada 60 s e o lease de retenção fica ocupado por 1 h.
 */
export class PrismaJobLease implements IJobLease, IJobLeaseSweep {
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

  /** `left(...) = prefix` em vez de LIKE: `_`/`%` do id do processo não viram curinga. */
  async deleteExpiredByPrefix(prefix: string, expiredBefore: Date): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM "job_leases"
      WHERE left("name", ${prefix.length}::int) = ${prefix} AND "expiresAt" < ${expiredBefore}`;
  }
}
