import type { Prisma } from '@prisma/client';

/**
 * Trava transacional por tenant do Saver (`pg_advisory_xact_lock`): serializa as checagens de teto do tenant
 * (pedido de extração: `saver_groups`/`saver_group_scans_per_day`; gravação da leitura: `saver_contacts`).
 * Sempre a PRIMEIRA trava da transação, antes de linhas de item/grupo, para não inverter a ordem.
 */
export async function lockSaverTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('saver_tenant:' || ${tenantId}, 0))`;
}
