import type { PrismaClient } from '@prisma/client';
import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Lê `TenantEntitlement` por (tenantId, key). Mora em campaigns por ora; pode migrar para
 * `tenants/infrastructure` quando outro módulo precisar.
 */
export class PrismaEntitlementReader implements IEntitlementReader {
  constructor(private readonly prisma: PrismaClient) {}

  async getNumber(tenantId: string, key: string): Promise<number | null> {
    const row = await this.prisma.tenantEntitlement.findUnique({
      where: { tenantId_key: { tenantId, key } },
      select: { value: true },
    });
    return row ? toNumber(row.value) : null;
  }
}
