import type { ISaverExtractionQueue } from '../../domain/contracts/ISaverExtractionQueue';

export interface CloseOrphanSaverExtractionsResult {
  /** Itens QUEUED/RUNNING de sessão excluída (lógica) cancelados. */
  cancelledItems: number;
  /** Extrações sem item pendente fechadas (DONE/PARTIAL/FAILED/CANCELLED). */
  closedExtractions: number;
  processed: number;
}

/**
 * Manutenção do Saver (design.md §3, SAVER-36), rodada pelo job sob lease. Sessão excluída é lógica
 * (`deletedAt`), então FK não dispara: cancela os itens pendentes dela (libera o índice parcial e outra
 * sessão pode reler o grupo) e fecha a extração que ficou sem item pendente. Só mexe em fila: nunca
 * apaga contato, vínculo nem grupo (expurgo fora da v1, D5).
 */
export class CloseOrphanSaverExtractionsUseCase {
  constructor(private readonly deps: { queue: Pick<ISaverExtractionQueue, 'cancelPendingForDeletedSessions' | 'closeFinished'> }) {}

  async execute({ now }: { now: Date }): Promise<CloseOrphanSaverExtractionsResult> {
    const cancelledItems = await this.deps.queue.cancelPendingForDeletedSessions(now);
    const closedExtractions = await this.deps.queue.closeFinished(now);
    return { cancelledItems, closedExtractions, processed: cancelledItems + closedExtractions };
  }
}
