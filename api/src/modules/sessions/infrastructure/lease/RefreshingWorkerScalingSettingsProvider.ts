import type { IWorkerScalingSettingsProvider } from '../../domain/contracts/IWorkerScalingSettingsProvider';
import type { IWorkerScalingSettingsRepository } from '../../domain/contracts/IWorkerScalingSettingsRepository';
import {
  parseSavedWorkerScalingSettings,
  resolveEffectiveSettings,
  type EffectiveWorkerScalingSettings,
  type WorkerScalingEnvDefaults,
} from '../../domain/services/workerScalingSettings';
import { logger } from '../../../../shared/logger/logger';

/** Recorte do logger usado aqui (pino `child`). */
export interface WorkerScalingSettingsLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface RefreshingWorkerScalingSettingsProviderOptions {
  repository: IWorkerScalingSettingsRepository;
  envDefaults: WorkerScalingEnvDefaults;
  logger?: WorkerScalingSettingsLogger;
  /** Intervalo do refresh periódico; padrão 30 s. */
  refreshMs?: number;
  /** Teto de uma leitura; estouro = falha de leitura. Padrão 5 s. */
  readTimeoutMs?: number;
}

export const WORKER_SCALING_REFRESH_MS = 30_000;
export const WORKER_SCALING_READ_TIMEOUT_MS = 5_000;

class WorkerScalingSettingsReadTimeoutError extends Error {
  override name = 'TimeoutError';
}

type FailureKind = 'read' | 'invalid';

/**
 * Configuração de escala em memória (WSCALE-03). Nasce com o default da env, sem I/O no
 * construtor. `refresh()` relê `platform_settings["worker_scaling"]`. Valor salvo inválido vale
 * como sem linha (default da env, igual ao GET); erro de leitura (banco fora) mantém o último
 * valor bom; leitura acima de 5 s conta como erro (nunca pendura o refresh nem o PUT). Os dois logam
 * `warn` uma vez por sequência, sem o conteúdo.
 */
export class RefreshingWorkerScalingSettingsProvider implements IWorkerScalingSettingsProvider {
  private effective: EffectiveWorkerScalingSettings;
  private failing: FailureKind | null = null;
  private inFlight: Promise<void> | null = null;
  /** No máximo uma leitura pendente atrás da que está em curso. */
  private queued: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly log: WorkerScalingSettingsLogger;

  constructor(private readonly options: RefreshingWorkerScalingSettingsProviderOptions) {
    this.effective = resolveEffectiveSettings(null, options.envDefaults);
    this.log = options.logger ?? logger.child({ module: 'RefreshingWorkerScalingSettingsProvider' });
  }

  current(): EffectiveWorkerScalingSettings {
    return this.effective;
  }

  /**
   * Com leitura em curso, encadeia uma nova depois dela: quem chama logo após gravar (PUT) vê o
   * valor novo, nunca o lido antes do UPDATE. Chamadas no meio dividem a mesma pendente; com a
   * pendente já agendada (inclusive entre o fim da leitura e o início dela) não abre outra.
   */
  refresh(): Promise<void> {
    if (this.queued) return this.queued;
    if (!this.inFlight) return this.startLoad();
    const next = () => {
      this.queued = null;
      return this.startLoad();
    };
    this.queued = this.inFlight.then(next, next);
    return this.queued;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.refresh(), this.options.refreshMs ?? WORKER_SCALING_REFRESH_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private startLoad(): Promise<void> {
    const run = this.load().finally(() => {
      if (this.inFlight === run) this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async load(): Promise<void> {
    let record;
    try {
      record = await this.readWithTimeout();
    } catch (err) {
      this.warnOnce('read', { err: (err as Error | null)?.name },
        'worker scaling settings refresh failed; keeping last good value');
      return;
    }
    const saved = parseSavedWorkerScalingSettings(record);
    this.effective = resolveEffectiveSettings(saved, this.options.envDefaults);
    if (record && saved === null) {
      this.warnOnce('invalid', {}, 'worker scaling settings: stored value is invalid; using env defaults');
      return;
    }
    this.failing = null;
  }

  private readWithTimeout(): ReturnType<IWorkerScalingSettingsRepository['get']> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new WorkerScalingSettingsReadTimeoutError('read timed out')),
        this.options.readTimeoutMs ?? WORKER_SCALING_READ_TIMEOUT_MS);
      timer.unref();
    });
    return Promise.race([this.options.repository.get(), timeout]).finally(() => clearTimeout(timer));
  }

  private warnOnce(kind: FailureKind, obj: Record<string, unknown>, msg: string): void {
    if (this.failing === kind) return;
    this.failing = kind;
    this.log.warn(obj, msg);
  }
}
