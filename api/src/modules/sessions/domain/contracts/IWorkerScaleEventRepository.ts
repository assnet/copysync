/** Origem do pedido de escala (WSCALE-13). */
export type WorkerScaleTrigger = 'manual' | 'auto';

/**
 * Resultado do pedido. `requested` é gravado antes da chamada externa; `succeeded` quando o
 * escalador aceitou (202); `failed` quando a chamada deu erro; `rejected` quando a regra recusou
 * sem chamar (intervalo mínimo, capacidade, `maxReplicas`...).
 */
export type WorkerScaleOutcome = 'requested' | 'succeeded' | 'failed' | 'rejected';

/** Teto de `reason` e `error`; o repositório trunca o excedente. */
export const WORKER_SCALE_TEXT_MAX = 200;

export interface NewWorkerScaleEvent {
  trigger: WorkerScaleTrigger;
  /** `User.id`; `null` = sistema (job automático). */
  actorUserId: string | null;
  fromReplicas: number;
  toReplicas: number;
  reason: string;
  outcome: WorkerScaleOutcome;
  error?: string | null;
  /** Idempotência do pedido manual; `null` no job. */
  requestId?: string | null;
}

export interface WorkerScaleEvent extends Required<NewWorkerScaleEvent> {
  id: number;
  at: Date;
}

export interface WorkerScaleEventPage {
  items: WorkerScaleEvent[];
  /** Id do último item quando há próxima página (a rota assina como cursor opaco); `null` = fim. */
  nextBeforeId: number | null;
}

/** `worker_scale_events` (WSCALE-13). Sem tenant: dado de infraestrutura. */
export interface IWorkerScaleEventRepository {
  /** Grava e devolve o id. `requestId` repetido lança (unicidade); use `findByRequestId` antes. */
  record(event: NewWorkerScaleEvent): Promise<number>;
  updateOutcome(id: number, outcome: WorkerScaleOutcome, error?: string | null): Promise<void>;
  /**
   * Horário do último pedido que conta para o intervalo mínimo: `requested` ou `succeeded`
   * (queda no meio da chamada deixa `requested` e o intervalo conta a partir do pedido).
   */
  lastSucceededAt(): Promise<Date | null>;
  findByRequestId(requestId: string): Promise<WorkerScaleEvent | null>;
  /** Mais recentes primeiro (`id desc`); `beforeId` vem do cursor decodificado. */
  list(input: { beforeId?: number | null; limit: number }): Promise<WorkerScaleEventPage>;
  /** Apaga `at < cutoff` em lotes (`statement_timeout` 2 s por lote); devolve o total apagado. */
  deleteOlderThan(cutoff: Date, batchSize?: number): Promise<number>;
}
