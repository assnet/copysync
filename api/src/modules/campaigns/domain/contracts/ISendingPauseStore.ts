/**
 * Pausa global de envios do tenant (fila de envio). Enquanto houver instante, o worker não
 * reivindica nenhum envio do tenant; captura e enfileiramento continuam. Ver docs/fila-de-envio.md.
 */
export interface ISendingPauseStore {
  /** Instante em que os envios foram pausados; null = ativos. */
  get(tenantId: string): Promise<Date | null>;
  set(tenantId: string, pausedAt: Date | null): Promise<void>;
}
