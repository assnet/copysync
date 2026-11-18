import type { FeatureUsageCutovers } from '../services/featureUsageCatalog';
import type { UsageReadBudget } from './IUsageReadGate';
import type { FeatureUsageDropCounts } from './IFeatureUsageRecorder';

/**
 * Por que o backfill parou: `FIRST_DATA` = chegou ao primeiro dado das fontes (nada antes existe, o agregado vale
 * para qualquer período até 400 dias); `RETENTION` = parou no teto de 400 dias (antes de `backfilledFrom` não há
 * cobertura).
 */
export type FeatureUsageBackfillStopReason = 'FIRST_DATA' | 'RETENTION';

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
  /** Marco: motivo da parada (`null` sem marco; marco gravado antes do campo existir = `RETENTION`, o conservador). */
  backfillStopReason: FeatureUsageBackfillStopReason | null;
  /** Progresso: dia mais recente ainda a consolidar no backfill (anda para trás); `null` = não começou. */
  backfillCursor: string | null;
  /** Último tick que consolidou a janela recente inteira até hoje sem falha (`freshAt` da leitura do agregado). */
  lastSuccessAt: Date | null;
  /** Dias até aqui (inclusive) não são mais recalculados; o tick recalcula de `finalizedThrough + 1` até hoje. */
  finalizedThrough: string | null;
  /** Ticks seguidos com falha (fonte ou gravação, janela recente ou backfill); zera no primeiro tick sem falha. */
  failureStreak: number;
  /** Cortes gravados pelo contador (recurso `CUTOVER` → primeiro dia do contador). */
  cutovers: FeatureUsageCutovers;
  /** Usos descartados pelo teto do contador, por dia × recurso (`platform_settings["feature_usage_dropped"]`). */
  dropped?: FeatureUsageDropCounts;
}

/** Resultado de um tick para o estado: o que não vier não muda. */
export interface FeatureUsageTickPatch {
  lastSuccessAt?: Date;
  finalizedThrough?: string;
  failureStreak: number;
}

export interface IFeatureUsageRollupStateRepository {
  /** Ausente ou inválido = vazio. Com `budget` (leitura do painel), a ida ao banco gasta o orçamento do pedido. */
  get(budget?: UsageReadBudget): Promise<FeatureUsageRollupState>;
  /** Grava só o progresso; não toca no marco. */
  saveBackfillCursor(day: string): Promise<void>;
  /** Grava o marco uma única vez; `false` se já existia (não muda). */
  markBackfillCompleted(marker: { completedAt: Date; backfilledFrom: string; stopReason: FeatureUsageBackfillStopReason }): Promise<boolean>;
  /** Grava o resultado do tick (merge; não toca no marco nem no cursor). */
  recordTick(patch: FeatureUsageTickPatch): Promise<void>;
}

/** Destino dos descartes do contador (soma por dia × recurso, uma instrução, sem lease: soma comutativa). */
export interface IFeatureUsageDropStore {
  addDrops(counts: FeatureUsageDropCounts): Promise<void>;
}

/**
 * Corte do contador (recurso `CUTOVER`): gravado uma única vez, atômico. Quem chega depois recebe o já gravado.
 */
export interface IFeatureUsageCutoverStore {
  /** Grava `day` como corte de `featureKey` se ainda não há; devolve o corte em vigor. */
  claimCutover(featureKey: string, day: string): Promise<string>;
}
