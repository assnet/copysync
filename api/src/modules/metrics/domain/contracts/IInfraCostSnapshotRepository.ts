/** Papel do recurso na infraestrutura (nunca o id da Render). */
export type InfraResourceKey = 'api' | 'worker' | 'redis' | 'postgres' | 'static';
export type InfraInstancesSource = 'samples' | 'render';
export type InfraFxRateSource = 'ptax' | 'sgs';
export type InfraUsageMetric = 'bandwidth_gb' | 'build_minutes';
export type InfraUsageSource = 'render_metrics' | 'render_deploys';

/** Retenção dos snapshots (COST-10). */
export const INFRA_COST_SNAPSHOT_RETENTION_DAYS = 400;

/** Linha de `infra_resource_hours`: um recurso numa hora cheia (UTC). */
export interface InfraResourceHourSnapshot {
  hour: Date;
  resourceKey: InfraResourceKey;
  plan: string | null;
  instances: number;
  instancesSource: InfraInstancesSource;
  diskGb: number | null;
  suspended: boolean;
}

/** Uma hora de um tenant: soma em `tenant_session_hours` do dia (UTC) da hora. */
export interface TenantSessionHourSample {
  tenantId: string;
  planSlug: string | null;
  connectedSessions: number;
  contractedSessions: number;
}

export interface InfraFxRateRecord {
  /** Dia de referência (meia-noite UTC). */
  referenceDate: Date;
  rate: number;
  source: InfraFxRateSource;
  fetchedAt: Date;
}

/** Uso medido de um dia (UTC) por recurso. */
export interface InfraUsageDailyValue {
  day: Date;
  metric: InfraUsageMetric;
  resourceKey: InfraResourceKey;
  value: number;
  source: InfraUsageSource;
}

/** Linhas apagadas por tabela na retenção. */
export interface InfraCostSnapshotPurgeResult {
  resourceHours: number;
  sessionHours: number;
  fxRates: number;
  usageDaily: number;
}

/**
 * Snapshots horários dos custos (COST-09/10). Escrita idempotente: repetir a mesma hora não dobra,
 * nem com dois processos gravando a mesma hora. `tenant_session_hours` é tenant-aware.
 */
export interface IInfraCostSnapshotRepository {
  /** A hora cheia já tem alguma linha em `infra_resource_hours`? */
  hasResourceHour(hour: Date): Promise<boolean>;
  /** Upsert por `(hour, resourceKey)`: regrava a linha (nunca soma). Devolve quantas linhas. */
  upsertResourceHours(rows: readonly InfraResourceHourSnapshot[]): Promise<number>;
  /**
   * Soma a hora no dia (UTC) de cada tenant só se `lastHour < hour` (hora já somada é ignorada).
   * Devolve quantos tenants foram somados.
   */
  addSessionHour(hour: Date, samples: readonly TenantSessionHourSample[]): Promise<number>;
  /** Upsert por `referenceDate`. */
  upsertFxRate(record: InfraFxRateRecord): Promise<void>;
  /** Cotação mais recente com `referenceDate <= onOrBefore`; null = nenhuma. */
  latestFxRate(onOrBefore: Date): Promise<InfraFxRateRecord | null>;
  /**
   * Banda: soma o valor da hora no dia (e +1 em `hours`) só se `lastHour` for nulo ou menor que `hour`.
   * True = somou.
   */
  addUsageHour(hour: Date, value: Omit<InfraUsageDailyValue, 'day'>): Promise<boolean>;
  /** Maior `lastHour` da métrica (qualquer recurso) a partir de `since`; null = nenhuma hora gravada. */
  lastUsageHour(metric: InfraUsageMetric, since: Date): Promise<Date | null>;
  /** Algum recurso tem linha da métrica no dia (UTC)? Fechamento espera o build do último dia. */
  hasUsageDay(metric: InfraUsageMetric, day: Date): Promise<boolean>;
  /** Build: regrava o valor do dia (idempotente). */
  upsertUsageDay(value: InfraUsageDailyValue): Promise<void>;
  /** Apaga o que for anterior a `cutoff` nas quatro tabelas, em lotes. */
  deleteOlderThan(cutoff: Date): Promise<InfraCostSnapshotPurgeResult>;
}
