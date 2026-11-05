import type { SubscriptionUsage } from '../services/subscriptionLimits';

/**
 * Uso consolidado do tenant para a tela "Assinatura" (SUB-05). Mesmas regras de contagem das telas
 * de recurso: sessões não apagadas; grupos só de sessões existentes; rodízios por engine da sessão;
 * ofertas e pedidos de IA (plataforma) desde a meia-noite de `startOfDayInZone`.
 */
export interface ITenantUsageReader {
  read(tenantId: string): Promise<SubscriptionUsage>;
}
