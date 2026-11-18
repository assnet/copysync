import type { FeatureUsageCutovers } from '../services/featureUsageCatalog';
import type { UsageReadBudget } from './IUsageReadGate';

/**
 * Estado da consolidação do uso em `platform_settings["feature_usage_rollup"]` (design §4.4, D14) e os cortes do
 * contador em `platform_settings["feature_usage_cutover"]`. Nada em memória: réplica nova ou reinício leem o mesmo
 * estado. A leitura do painel consulta tudo a cada pedido (uma instrução).
 */
export interface FeatureUsageRollupState {
  /** Marco: instante em que o backfill terminou; `null` enquanto não terminou. */
  backfillCompletedAt: Date | null;
  /** Marco: primeiro dia (Brasília) coberto pelo agregado para os recursos `LIVE`. */
  backfilledFrom: string | null;
  /** Progresso: dia mais recente ainda a consolidar no backfill (anda para trás); `null` = não começou. */
  backfillCursor: string | null;
  /** Cortes gravados pelo contador (recurso `CUTOVER` → primeiro dia do contador). */
  cutovers: FeatureUsageCutovers;
}

export interface IFeatureUsageRollupStateRepository {
  /** Ausente ou inválido = vazio. Com `budget` (leitura do painel), a ida ao banco gasta o orçamento do pedido. */
  get(budget?: UsageReadBudget): Promise<FeatureUsageRollupState>;
  /** Grava só o progresso; não toca no marco. */
  saveBackfillCursor(day: string): Promise<void>;
  /** Grava o marco uma única vez; `false` se já existia (não muda). */
  markBackfillCompleted(marker: { completedAt: Date; backfilledFrom: string }): Promise<boolean>;
}

/**
 * Corte do contador (recurso `CUTOVER`): gravado uma única vez, atômico. Quem chega depois recebe o já gravado.
 */
export interface IFeatureUsageCutoverStore {
  /** Grava `day` como corte de `featureKey` se ainda não há; devolve o corte em vigor. */
  claimCutover(featureKey: string, day: string): Promise<string>;
}
