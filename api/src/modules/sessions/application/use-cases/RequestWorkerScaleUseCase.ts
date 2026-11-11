import type { ScaleWorkersResult, ScaleWorkersUseCase } from './ScaleWorkersUseCase';
import type { WorkerScalerStateCache } from '../services/WorkerScalerStateCache';

export interface RequestWorkerScaleInput {
  replicas: number;
  reason: string;
  requestId: string;
  actorUserId: string;
}

export interface RequestWorkerScaleDeps {
  scale: Pick<ScaleWorkersUseCase, 'execute'>;
  /** Sessões conectadas agora (`connectedSessionsNow`: última amostra `sessions_connected`). */
  connectedSessions: () => Promise<number>;
  /** Cache do `GET`: invalidado depois do pedido aceito para a tela ver o alvo novo. */
  state: Pick<WorkerScalerStateCache, 'invalidate'>;
}

/** Pedido manual do super admin (WSCALE-12): conta as conectadas e delega ao `ScaleWorkersUseCase`. */
export class RequestWorkerScaleUseCase {
  constructor(private readonly deps: RequestWorkerScaleDeps) {}

  async execute(input: RequestWorkerScaleInput): Promise<ScaleWorkersResult> {
    const connected = await this.deps.connectedSessions();
    const result = await this.deps.scale.execute({ ...input, reason: input.reason.trim(), trigger: 'manual', connected });
    this.deps.state.invalidate();
    return result;
  }
}
