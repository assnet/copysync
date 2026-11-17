import type { FeatureUsageKind } from '../services/featureUsageCatalog';

/** Uma linha do agregado de um dia: conta × recurso × tipo do evento. Só contagem. */
export interface FeatureUsageDayRow {
  tenantId: string;
  featureKey: string;
  kind: FeatureUsageKind;
  uses: number;
}

/** Um uso registrado pelo contador: o dia gravado é `dayInZone(at)` (Brasília), nunca o dia UTC. */
export interface FeatureUsageCount {
  tenantId: string;
  featureKey: string;
  kind: FeatureUsageKind;
  at: Date;
}

/**
 * Agregado diário `feature_usage_daily` (design §4.3–§4.5). Dia sempre `YYYY-MM-DD` de Brasília.
 * Todo `INSERT` grava `"updatedAt"` explicitamente (a coluna não tem `DEFAULT`).
 */
export interface IFeatureUsageDailyRepository {
  /**
   * Regrava o dia só para as chaves de `keys`, numa única transação: apaga as linhas dessas chaves que não estão
   * em `rows` (zeraram) e grava `rows` com `ON CONFLICT DO UPDATE`. Chave fora de `keys` não é tocada nem apagada;
   * linha de `rows` com chave fora de `keys` é erro de programação (lança antes de ir ao banco). Idempotente.
   */
  replaceDay(day: string, keys: readonly string[], rows: readonly FeatureUsageDayRow[]): Promise<void>;
  /** +1 na linha do dia (cria com 1). */
  increment(count: FeatureUsageCount): Promise<void>;
  /** Grava `uses = 1` se a linha do dia ainda não existe; senão não faz nada. */
  markOnce(count: FeatureUsageCount): Promise<void>;
  /** Menor dia gravado (das chaves informadas, ou de todas), `null` sem linha. */
  oldestDay(keys?: readonly string[]): Promise<string | null>;
  /** Maior `updatedAt` gravado, `null` sem linha. */
  latestUpdate(): Promise<Date | null>;
  /** Apaga `day < before` em lotes curtos; devolve quantas linhas saíram. */
  purgeBefore(before: string): Promise<number>;
}
