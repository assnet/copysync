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

/** Tamanho em code points (o que `varchar(n)` do Postgres conta). */
export const textLength = (s: string): number => Array.from(s).length;
/** Corta em `max` code points sem partir par substituto. */
export const truncateText = (s: string, max: number): string =>
  s.length <= max ? s : Array.from(s).slice(0, max).join('');

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

/**
 * Resultado de `recordRequestedIfIdle`: id do `requested` gravado, fim do intervalo mínimo ou o
 * evento que já tinha o mesmo `requestId` (replay concorrente; quem chama compara alvo/motivo/ator).
 */
export type RecordRequestedResult = { id: number } | { blocked: Date } | { existing: WorkerScaleEvent };

/** `worker_scale_events` (WSCALE-13). Sem tenant: dado de infraestrutura. */
export interface IWorkerScaleEventRepository {
  /** Grava e devolve o id. `requestId` repetido lança (unicidade); use `findByRequestId` antes. */
  record(event: NewWorkerScaleEvent): Promise<number>;
  /**
   * Grava `evt` como `requested` só se o último `requested|succeeded` estiver fora de
   * `cooldownSeconds` contados até `now`; senão devolve `{ blocked: retryAt }` sem gravar. Leitura e
   * insert serializados por `pg_advisory_xact_lock` de chave fixa: dois pedidos simultâneos (com
   * `requestId` diferentes) não passam juntos. `requestId` já gravado (checado sob o lock, antes do
   * intervalo) devolve `{ existing }` sem gravar.
   */
  recordRequestedIfIdle(input: {
    evt: Omit<NewWorkerScaleEvent, 'outcome' | 'error'>;
    cooldownSeconds: number;
    now: Date;
  }): Promise<RecordRequestedResult>;
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
