import type { FeatureUsageDefinition } from '../services/featureUsageCatalog';
import type { UsageReadBudget } from './IUsageReadGate';

/**
 * Contas com direito a cada recurso hoje (P3, denominador da adoção). Uma leitura em lote para todas as contas,
 * no orçamento e na vaga do pedido (não abre vaga própria). Direito lido hoje, não na data do uso.
 */
export interface IFeatureEligibilityReader {
  /** Chave do recurso → contas com direito (todas as contas; o recorte é do agregador). */
  read(features: readonly FeatureUsageDefinition[], budget: UsageReadBudget): Promise<Map<string, Set<string>>>;
}
