import type { IWorkerScaleEventRepository, WorkerScaleEvent } from '../../domain/contracts/IWorkerScaleEventRepository';
import type { WorkerScalerState } from '../../domain/contracts/IWorkerScaler';
import type { IWorkerScalingSettingsProvider } from '../../domain/contracts/IWorkerScalingSettingsProvider';
import type { WorkerScalingSettings } from '../../domain/services/workerScalingSettings';
import type { WorkerScalerStateCache } from '../services/WorkerScalerStateCache';

export type WorkerScaleSettingsView = Pick<
  WorkerScalingSettings,
  'scalerMode' | 'minReplicas' | 'maxReplicas' | 'scaleCooldownSeconds'
>;

export interface WorkerScaleStateView {
  /** Estado do escalador (cache de 30 s). Nunca carrega chave nem id do serviço. */
  scaler: WorkerScalerState;
  settings: WorkerScaleSettingsView;
  /** Fim do intervalo mínimo desde o último pedido aceito; `null` sem pedido ou já vencido. */
  cooldownUntil: Date | null;
  lastEvent: WorkerScaleEvent | null;
  /** Último evento do job automático (`trigger = auto`), qualquer resultado; `null` se nunca houve. */
  lastAutoEvent: WorkerScaleEvent | null;
  /** Adoção em vigor no cluster (mesmo `enforced` de `/settings`). */
  enforced: boolean;
}

export interface GetWorkerScaleStateDeps {
  state: Pick<WorkerScalerStateCache, 'get'>;
  /** O mesmo provider que o pedido de escala consulta: a tela mostra a regra que vale no `POST`. */
  settings: Pick<IWorkerScalingSettingsProvider, 'current'>;
  events: Pick<IWorkerScaleEventRepository, 'list' | 'lastCooldownStartAt' | 'latestByTrigger'>;
  isEnforced: () => Promise<boolean>;
  now?: () => Date;
}

/** Aba Escala (WSCALE-14): estado do escalador, faixa, intervalo mínimo e último evento. */
export class GetWorkerScaleStateUseCase {
  constructor(private readonly deps: GetWorkerScaleStateDeps) {}

  async execute(): Promise<WorkerScaleStateView> {
    const { scalerMode, minReplicas, maxReplicas, scaleCooldownSeconds } = this.deps.settings.current().value;
    const [scaler, last, page, lastAuto, enforced] = await Promise.all([
      this.deps.state.get(),
      this.deps.events.lastCooldownStartAt(),
      this.deps.events.list({ limit: 1 }),
      this.deps.events.latestByTrigger('auto'),
      this.deps.isEnforced(),
    ]);
    const until = last ? new Date(last.getTime() + scaleCooldownSeconds * 1000) : null;
    const now = this.deps.now?.() ?? new Date();
    return {
      scaler,
      settings: { scalerMode, minReplicas, maxReplicas, scaleCooldownSeconds },
      cooldownUntil: until && until.getTime() > now.getTime() ? until : null,
      lastEvent: page.items[0] ?? null,
      lastAutoEvent: lastAuto,
      enforced,
    };
  }
}
