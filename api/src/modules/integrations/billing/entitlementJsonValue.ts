import { Prisma } from '@prisma/client';

/**
 * Valor de entitlement para escrita em coluna `Json?`. Prisma não aceita `null` puro: preset `null`
 * (= ilimitado) vira JSON null, que `PrismaEntitlementReader.getNumber` lê como `null`. Não usar
 * fallback `'false'`: apagaria o ilimitado e o upgrade herdaria o limite do plano anterior.
 */
export function entitlementJsonValue(value: Prisma.JsonValue | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}
