/**
 * Controle de leitura do uso dos recursos (design §4.1). Sem banco: só o contrato.
 *
 * Orçamento do pedido: todas as idas ao banco do pedido (fontes, primeiro dado, diretório de contas)
 * gastam o mesmo tempo. `track` registra a instrução em curso; `settled` resolve quando todas
 * terminaram (inclusive a órfã que o temporizador abandonou).
 */
export interface UsageReadBudget {
  /** Milissegundos que ainda restam (pode ser ≤ 0). */
  remainingMs(): number;
  track(instruction: Promise<unknown>): void;
  settled(): Promise<void>;
}

/**
 * Uma leitura de uso por processo. Ocupada: o pedido espera a vaga em fila FIFO curta, dentro do próprio
 * orçamento (que começa na chegada); fila cheia ou orçamento vencido na espera lança
 * `UsageMetricsReadUnavailableError` sem ir ao banco. A vaga só volta quando a última instrução do pedido
 * resolve ou falha.
 */
export interface IUsageReadGate {
  runExclusive<T>(read: (budget: UsageReadBudget) => Promise<T>): Promise<T>;
}
