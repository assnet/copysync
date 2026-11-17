import type { UsageReadBudget } from './IUsageReadGate';

/**
 * Estado da consolidação do uso em `platform_settings["feature_usage_rollup"]` (design §4.4, D14). Nada em memória:
 * réplica nova ou reinício leem o mesmo marco. A leitura (T22) consulta o marco a cada pedido.
 */
export interface FeatureUsageRollupState {
  /** Marco: instante em que o backfill terminou; `null` enquanto não terminou. */
  backfillCompletedAt: Date | null;
  /** Marco: primeiro dia (Brasília) coberto pelo agregado para os recursos `LIVE`. */
  backfilledFrom: string | null;
  /** Progresso: dia mais recente ainda a consolidar no backfill (anda para trás); `null` = não começou. */
  backfillCursor: string | null;
}

export interface IFeatureUsageRollupStateRepository {
  /** Ausente ou inválido = tudo `null`. Com `budget` (leitura do painel), a ida ao banco gasta o orçamento do pedido. */
  get(budget?: UsageReadBudget): Promise<FeatureUsageRollupState>;
  /** Grava só o progresso; não toca no marco. */
  saveBackfillCursor(day: string): Promise<void>;
  /** Grava o marco uma única vez; `false` se já existia (não muda). */
  markBackfillCompleted(marker: { completedAt: Date; backfilledFrom: string }): Promise<boolean>;
}
