import type { IWorkerScaler, WorkerScalerState } from '../../domain/contracts/IWorkerScaler';

/** Validade do estado na tela (design §6: a aba atualiza a cada 20 s). */
export const WORKER_SCALER_STATE_TTL_MS = 30_000;

/**
 * Cache do `getState` por processo, só para `GET /admin/workers/scale`: poupa a API do provedor
 * (limite de taxa) quando várias abas ficam abertas. O pedido de escala lê sempre ao vivo e chama
 * `invalidate()` depois de aceito. Leituras simultâneas compartilham a mesma promessa.
 * Não é estado operacional: perder o cache só custa uma leitura nova.
 */
export class WorkerScalerStateCache {
  private entry: { at: number; state: Promise<WorkerScalerState> } | null = null;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly scaler: Pick<IWorkerScaler, 'getState'>,
    options: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.ttlMs = options.ttlMs ?? WORKER_SCALER_STATE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  get(): Promise<WorkerScalerState> {
    const t = this.now();
    if (this.entry && t - this.entry.at < this.ttlMs) return this.entry.state;
    const state = this.scaler.getState();
    const entry = { at: t, state };
    this.entry = entry;
    // `getState` não deve lançar; se lançar, não guarda a falha.
    state.catch(() => {
      if (this.entry === entry) this.entry = null;
    });
    return state;
  }

  invalidate(): void {
    this.entry = null;
  }
}
