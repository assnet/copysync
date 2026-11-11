import type { IWorkerScaler, WorkerScalerConfigKey, WorkerScalerState } from '../../domain/contracts/IWorkerScaler';
import { ScalerNotConfiguredError } from '../../../../shared/errors/internal/WorkerScalingErrors';

/** Escalador sem envs suficientes: nenhuma chamada sai; `missing` só com nomes das envs. */
export class NotConfiguredWorkerScaler implements IWorkerScaler {
  private readonly missing: readonly WorkerScalerConfigKey[];

  constructor(missing: readonly WorkerScalerConfigKey[]) {
    this.missing = [...missing];
  }

  async getState(): Promise<WorkerScalerState> {
    return { status: 'not_configured', missing: [...this.missing] };
  }

  async scaleTo(): Promise<void> {
    throw new ScalerNotConfiguredError(this.missing);
  }
}
