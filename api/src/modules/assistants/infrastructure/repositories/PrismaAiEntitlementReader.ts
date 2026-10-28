import type { PrismaClient } from '@prisma/client';
import type { IAiEntitlementReader } from '../../domain/contracts/IAiEntitlementReader';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';

export const AI_REWRITE_ENTITLEMENT_KEY = ENTITLEMENT_KEYS.AI_REWRITE_ENABLED;
export const AI_REQUESTS_PER_DAY_ENTITLEMENT_KEY = ENTITLEMENT_KEYS.AI_REQUESTS_PER_DAY;

/** Só `false` explícito (booleano ou texto) desliga; ausente ou null = liberado. */
export function entitlementAllows(value: unknown): boolean {
  return !(value === false || value === 'false');
}

/** Número inteiro ≥ 0 (número ou texto numérico); qualquer outra coisa = null. */
export function entitlementCount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export class PrismaAiEntitlementReader implements IAiEntitlementReader {
  constructor(private readonly prisma: PrismaClient) {}

  async isAiRewriteEnabled(tenantId: string): Promise<boolean> {
    return entitlementAllows(await this.value(tenantId, AI_REWRITE_ENTITLEMENT_KEY));
  }

  async aiRequestsPerDay(tenantId: string): Promise<number | null> {
    return entitlementCount(await this.value(tenantId, AI_REQUESTS_PER_DAY_ENTITLEMENT_KEY));
  }

  private async value(tenantId: string, key: string): Promise<unknown> {
    const row = await this.prisma.tenantEntitlement.findUnique({
      where: { tenantId_key: { tenantId, key } },
      select: { value: true },
    });
    return row?.value;
  }
}
