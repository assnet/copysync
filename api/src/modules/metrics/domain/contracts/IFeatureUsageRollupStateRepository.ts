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
 * Estado de um grupo de fontes (recursos lidos numa instrução) no job: os grupos andam independentes, um grupo com
 * erro persistente não trava os outros. Chave do grupo = chaves dos recursos unidas por `+` (`featureUsageGroupId`).
 */
export interface FeatureUsageGroupState {
  /** Ticks seguidos com falha do grupo (janela recente ou reprocesso); `error` no log a partir de 3. */
  failureStreak: number;
  /**
   * Frescor do grupo: último tick em que a janela recente do grupo chegou a hoje sem falha, sem (dia, grupo) pendente
   * no reprocesso e sem falha no backfill dele. A leitura do agregado usa o menor frescor dos grupos dos recursos pedidos.
   */
  lastSuccessAt: Date | null;
  /** Backfill do grupo: dia mais recente ainda a consolidar (anda para trás); `null` = não começou. */
  backfillCursor: string | null;
  /** Backfill do grupo concluído: primeiro dia coberto e motivo da parada. */
  backfillDone: { from: string; reason: FeatureUsageBackfillStopReason } | null;
  /** Passos de backfill seguidos com falha; com 3+ o grupo pode ficar pendente no marco. */
  backfillFailures: number;
  /**
   * Piso de reprocesso: menor dia descartado do reprocesso cheio. O job recalcula 1 dia por tick daqui para frente
   * até entrar na faixa da revisita (hoje − 30); `null`/ausente = nada a recalcular.
   */
  reprocessFrom?: string | null;
}

/**
 * (dia, grupo) que falhou fora da janela recente: retentado a cada tick, no máximo 30 itens. Cheio, o mais antigo sai
 * e vira piso de reprocesso do grupo (`reprocessFrom`).
 */
export interface FeatureUsageRetryItem {
  day: string;
  group: string;
}

/** Id estável do grupo de fontes. */
export function featureUsageGroupId(keys: readonly string[]): string {
  return keys.join('+');
}

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
  /**
   * Último tick inteiro sem falha: janela recente de todos os grupos até hoje e backfill não `failed`. A leitura usa
   * o frescor por grupo (`groups[].lastSuccessAt`); este campo é o frescor de estado antigo, sem grupos.
   */
  lastSuccessAt: Date | null;
  /** Dias até aqui (inclusive) não são mais recalculados; o tick recalcula de `finalizedThrough + 1` até hoje. */
  finalizedThrough: string | null;
  /** Ticks seguidos com falha (fonte ou gravação, janela recente ou backfill); zera no primeiro tick sem falha. */
  failureStreak: number;
  /** Cortes gravados pelo contador (recurso `CUTOVER` → primeiro dia do contador). */
  cutovers: FeatureUsageCutovers;
  /** Usos descartados pelo teto do contador, por dia × recurso (`platform_settings["feature_usage_dropped"]`). */
  dropped?: FeatureUsageDropCounts;
  /** Estado por grupo de fontes. Ausente = estado gravado antes dos grupos. */
  groups?: Readonly<Record<string, FeatureUsageGroupState>>;
  /** Reprocesso de (dia, grupo) que falhou; no máximo 30, os mais antigos saem (log `error`) para o `reprocessFrom`. */
  retryQueue?: readonly FeatureUsageRetryItem[];
  /** Revisita leve: próximo dia antigo (≤ hoje − 2, ≥ hoje − 30) a recalcular; anda para trás em rodízio. */
  revisitCursor?: string | null;
  /**
   * Recursos cujo grupo ainda não concluiu o backfill quando o marco foi gravado (grupo com falha persistente).
   * A leitura trata esses recursos como não cobertos pelo agregado. Sai daqui quando o grupo conclui.
   */
  backfillPendingKeys?: readonly string[];
}

/** Resultado de um tick para o estado: o que não vier não muda. */
export interface FeatureUsageTickPatch {
  lastSuccessAt?: Date;
  finalizedThrough?: string;
  failureStreak: number;
  /** Substituem o valor gravado quando vêm. */
  groups?: Readonly<Record<string, FeatureUsageGroupState>>;
  retryQueue?: readonly FeatureUsageRetryItem[];
  revisitCursor?: string;
  backfillPendingKeys?: readonly string[];
}

export interface IFeatureUsageRollupStateRepository {
  /** Ausente ou inválido = vazio. Com `budget` (leitura do painel), a ida ao banco gasta o orçamento do pedido. */
  get(budget?: UsageReadBudget): Promise<FeatureUsageRollupState>;
  /** Grava só o progresso; não toca no marco. */
  saveBackfillCursor(day: string): Promise<void>;
  /** Grava o marco uma única vez (com os recursos pendentes, se houver); `false` se já existia (não muda). */
  markBackfillCompleted(marker: {
    completedAt: Date;
    backfilledFrom: string;
    stopReason: FeatureUsageBackfillStopReason;
    pendingKeys?: readonly string[];
  }): Promise<boolean>;
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
