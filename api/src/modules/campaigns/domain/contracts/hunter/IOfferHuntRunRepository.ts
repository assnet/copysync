import type { HuntProvider } from '../../hunter/HuntProvider';
import type { OfferHuntRankingItem, OfferHuntRun, OfferHuntRunSummary, OfferHuntRunCounters, OfferHuntRunTrigger } from '../../hunter/OfferHunt';

export interface StartOfferHuntRunInput {
  tenantId: string;
  huntId: string;
  /** Marca da caçada no momento da execução. */
  provider: HuntProvider;
  trigger: OfferHuntRunTrigger;
  startedAt: Date;
}

export interface FinishOfferHuntRunInput extends Omit<OfferHuntRunCounters, 'ranking'> {
  /** Ranking da execução (até 15); null = não chegou a montar. */
  ranking: OfferHuntRankingItem[] | null;
  status: 'SUCCEEDED' | 'FAILED';
  errorCode: string | null;
  finishedAt: Date;
}

export interface OfferHuntPageCursor {
  /** Chave do último item da página anterior (ordem: mais novo primeiro). */
  at: Date;
  id: string;
}

export interface IOfferHuntRunRepository {
  /**
   * Abre a execução (RUNNING) se o tenant abriu menos de `limit` desde `since` (SKIPPED não conta);
   * serializado por tenant: duas aberturas simultâneas não passam do teto. null = guarda atingida.
   */
  startWithinDailyLimit(input: StartOfferHuntRunInput, quota: { since: Date; limit: number }): Promise<OfferHuntRun | null>;
  /** Execução pulada antes de chamar a fonte (já fechada). */
  createSkipped(input: StartOfferHuntRunInput & { errorCode: string }): Promise<OfferHuntRun>;
  finish(tenantId: string, id: string, input: FinishOfferHuntRunInput): Promise<void>;
  /** Execuções abertas desde `since`, sem as SKIPPED (guarda técnica). */
  countStartedSince(tenantId: string, since: Date): Promise<number>;
  incrementSent(tenantId: string, id: string): Promise<void>;
  /** Histórico da caçada, mais nova primeiro; `after` = cursor keyset. */
  /** Sem a coluna `ranking` (só `hasRanking`). */
  listByHunt(tenantId: string, huntId: string, page: { limit: number; after?: OfferHuntPageCursor }): Promise<OfferHuntRunSummary[]>;
  /** Execução completa (com `ranking`) da caçada no tenant; null = não existe/outro tenant/outra caçada. */
  findById(tenantId: string, huntId: string, id: string): Promise<OfferHuntRun | null>;
}
