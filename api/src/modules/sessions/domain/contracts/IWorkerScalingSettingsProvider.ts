import type { EffectiveWorkerScalingSettings } from '../services/workerScalingSettings';

/**
 * Configuração efetiva de escala em memória do processo (WSCALE-03). Nasce com o default da env;
 * o refresh periódico (30 s, `unref`) e o processo que salvou atualizam o valor. Falha de leitura
 * mantém o último valor bom: nunca derruba adoção nem lease.
 */
export interface IWorkerScalingSettingsProvider {
  /** Valor efetivo atual, síncrono e sem I/O. Ler a cada uso, nunca guardar no construtor. */
  current(): EffectiveWorkerScalingSettings;
  /** Relê do repositório agora; não lança (falha mantém o valor anterior). */
  refresh(): Promise<void>;
  /** Liga o refresh periódico. Idempotente. */
  start(): void;
  /** Cancela o refresh periódico. */
  stop(): void;
}
