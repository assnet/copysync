import type { ScaleWorkersResult, ScaleWorkersUseCase } from './ScaleWorkersUseCase';
import type { WorkerScalerStateCache } from '../services/WorkerScalerStateCache';
import { InvalidScaleReasonError } from '../../../../shared/errors/internal/WorkerScalingErrors';
import { WORKER_SCALE_TEXT_MAX, textLength } from '../../domain/contracts/IWorkerScaleEventRepository';

/** Tamanho mínimo do motivo em code points depois do `trim` (a rota só barra vazio e > 1000). */
export const SCALE_REASON_MIN = 3;

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
  /** Cache do `GET`: invalidado depois de todo pedido (aceito ou não) para a tela ler o estado novo. */
  state: Pick<WorkerScalerStateCache, 'invalidate'>;
}

/** Pedido manual do super admin (WSCALE-12): conta as conectadas e delega ao `ScaleWorkersUseCase`. */
export class RequestWorkerScaleUseCase {
  constructor(private readonly deps: RequestWorkerScaleDeps) {}

  async execute(input: RequestWorkerScaleInput): Promise<ScaleWorkersResult> {
    const reason = input.reason.trim();
    const length = textLength(reason);
    if (length < SCALE_REASON_MIN || length > WORKER_SCALE_TEXT_MAX) {
      throw new InvalidScaleReasonError(SCALE_REASON_MIN, WORKER_SCALE_TEXT_MAX);
    }
    try {
      const connected = await this.deps.connectedSessions();
      return await this.deps.scale.execute({ ...input, reason, trigger: 'manual', connected });
    } finally {
      this.deps.state.invalidate();
    }
  }
}
