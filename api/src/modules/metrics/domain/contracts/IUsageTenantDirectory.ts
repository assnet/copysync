import type { UsageTenantEntry } from '../services/aggregateFeatureUsage';
import type { UsageReadBudget } from './IUsageReadGate';

/** Conta do recorte: planos já resolvidos por família (slug ou `NONE`, design §4.2). Sem nome. */
export interface UsageTenantDirectoryEntry extends UsageTenantEntry {
  createdAt: Date;
}

/**
 * Contas para as métricas de uso. As duas leituras gastam o orçamento do pedido e rodam dentro da vaga
 * do `IUsageReadGate` aberta por ele (não abrem vaga própria).
 */
export interface IUsageTenantDirectory {
  list(budget: UsageReadBudget): Promise<UsageTenantDirectoryEntry[]>;
  /** Nome só para os ids da página da lista de contas; `[]` não consulta o banco. */
  names(ids: readonly string[], budget: UsageReadBudget): Promise<Map<string, string>>;
}
