/** Janela da última `sessions_connected`/`sessions_capacity` (fonte `sessions`, recurso `cluster`). */
export const INFRA_COST_LIVE_SESSIONS_WINDOW_MS = 60 * 60_000;
/** Janela das instâncias distintas do serviço worker nas amostras da Render (COST-04). */
export const INFRA_COST_LIVE_WORKER_WINDOW_MS = 15 * 60_000;

/** Foto do momento para os custos (COST-04/05). Sem tenant: dado de infraestrutura. `null` = sem amostra. */
export interface InfraCostLiveReading {
  /** Última `sessions_connected` do cluster na janela de 1 h. */
  sessionsConnected: number | null;
  /** Última `sessions_capacity` do cluster na janela de 1 h. */
  sessionsCapacity: number | null;
  /** Hora da `sessions_connected` usada (a das não alocadas); `null` sem ela, mesmo com capacidade. */
  sessionsSampledAt: Date | null;
  /**
   * Instâncias distintas do serviço worker (`<id>-<sufixo>`) nas amostras da Render dos últimos
   * 15 min, só as atuais (amostra mais nova a até 2 min da mais nova do serviço, como a tabela de
   * instâncias: réplica trocada por deploy não soma); só o `<id>` sem sufixo conta 1. Sem id válido ou sem amostra = `null` (vale o manual).
   */
  workerInstances: number | null;
}

/** Leitura do momento em `ops_metrics_samples`, com teto de 2 s. A capacidade por plano vem de `IWorkerCapacityReader`. */
export interface IInfraCostLiveReader {
  read(now: Date): Promise<InfraCostLiveReading>;
}
