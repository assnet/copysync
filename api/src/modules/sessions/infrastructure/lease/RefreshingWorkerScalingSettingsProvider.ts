import type { IWorkerScalingSettingsProvider } from '../../domain/contracts/IWorkerScalingSettingsProvider';
import type { IWorkerScalingSettingsRepository } from '../../domain/contracts/IWorkerScalingSettingsRepository';
import {
  parseWorkerScalingSettings,
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
}

export const WORKER_SCALING_REFRESH_MS = 30_000;

/**
 * Configuração de escala em memória (WSCALE-03). Nasce com o default da env, sem I/O no
 * construtor. `refresh()` relê `platform_settings["worker_scaling"]`; erro de banco ou valor
 * inválido mantém o último valor bom e loga `warn` uma vez por sequência de falhas, sem o conteúdo.
 */
export class RefreshingWorkerScalingSettingsProvider implements IWorkerScalingSettingsProvider {
  private effective: EffectiveWorkerScalingSettings;
  private lastRecord: { updatedAt: Date; updatedById: string | null } | null = null;
  private failing = false;
  private inFlight: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly log: WorkerScalingSettingsLogger;

  constructor(private readonly options: RefreshingWorkerScalingSettingsProviderOptions) {
    this.effective = resolveEffectiveSettings(null, options.envDefaults);
    this.log = options.logger ?? logger.child({ module: 'RefreshingWorkerScalingSettingsProvider' });
  }

  current(): EffectiveWorkerScalingSettings {
    return this.effective;
  }

  /** `updatedAt`/`updatedById` do último registro bom (`null` sem linha). Fora do contrato. */
  lastUpdate(): { updatedAt: Date; updatedById: string | null } | null {
    return this.lastRecord;
  }

  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.load().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
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

  private async load(): Promise<void> {
    try {
      const record = await this.options.repository.get();
      const saved = record ? parseWorkerScalingSettings(record.value) : null;
      this.effective = resolveEffectiveSettings(saved, this.options.envDefaults);
      this.lastRecord = record ? { updatedAt: record.updatedAt, updatedById: record.updatedById } : null;
      this.failing = false;
    } catch (err) {
      if (this.failing) return;
      this.failing = true;
      this.log.warn(
        { err: (err as Error | null)?.name },
        'worker scaling settings refresh failed; keeping last good value',
      );
    }
  }
}
