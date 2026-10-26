import type { AiUsageEntry } from './AiRecords';

/** Janela e teto do limite diário de uso (linhas da origem desde `since`). */
export interface AiUsageQuota {
  since: Date;
  limit: number;
}

/** Desfecho gravado na reserva depois da chamada ao provedor. */
export interface AiUsageOutcome {
  success: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface IAiUsageLogRepository {
  record(entry: AiUsageEntry): Promise<void>;
  /**
   * Atômico por tenant: conta todas as linhas da origem desde `quota.since` (sucesso ou não) e,
   * abaixo do teto, grava `entry` como reserva. Devolve o id da reserva, ou null no limite.
   */
  reserveWithinDailyLimit(entry: AiUsageEntry, quota: AiUsageQuota): Promise<string | null>;
  /** Fecha a reserva com o desfecho da chamada. */
  complete(id: string, tenantId: string, outcome: AiUsageOutcome): Promise<void>;
}
