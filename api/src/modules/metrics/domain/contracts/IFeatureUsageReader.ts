import type { FeatureUsageRow } from '../services/aggregateFeatureUsage';
import type { FeatureUsageKey } from '../services/featureUsageCatalog';
import type { UsageGranularity } from '../services/featureUsagePeriod';
import type { UsageReadBudget } from './IUsageReadGate';

export interface FeatureUsageReadInput {
  /** Início do período (instante UTC, inclusivo). O período anterior entra alargando `from`. */
  from: Date;
  /** Fim do período (instante UTC, exclusivo). */
  toExclusive: Date;
  /** Recursos pedidos; fonte sem recurso pedido não é lida. */
  featureKeys: readonly FeatureUsageKey[];
  /** O leitor sob demanda sempre devolve linha por dia; o agregado (P2) agrupa acima de 90 dias. */
  granularity: UsageGranularity;
  /**
   * Início do período atual quando `from` já inclui o anterior. O agregado agrupado por semana/mês nunca junta
   * dias dos dois lados deste instante na mesma linha (o bucket que cruza vira duas linhas).
   */
  currentFrom?: Date;
  budget: UsageReadBudget;
}

export interface FeatureUsageReadResult {
  rows: FeatureUsageRow[];
  /** Primeiro dia com dado de cada recurso pedido (Brasília), `null` sem dado. Sem filtro de período. */
  firstDataDay: Partial<Record<FeatureUsageKey, string | null>>;
  /** Só o agregado: maior `updatedAt` gravado (`null` com a tabela vazia). */
  latestUpdate?: Date | null;
}

/** Linhas de uso por dia × conta × recurso × tipo. Só contagem: nada de conteúdo nem `userId`. */
export interface IFeatureUsageReader {
  read(input: FeatureUsageReadInput): Promise<FeatureUsageReadResult>;
}
