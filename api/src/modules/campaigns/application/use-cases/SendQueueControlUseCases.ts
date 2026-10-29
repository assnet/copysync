import type { IOfferDispatchRepository } from '../../domain/contracts/IOfferDispatchRepository';
import type { IOfferGeneratorConfigRepository } from '../../domain/contracts/IOfferGeneratorConfigRepository';
import type { ISendingPauseStore } from '../../domain/contracts/ISendingPauseStore';
import { respreadLane } from '../../domain/services/respreadLane';
import { DEFAULT_INTERVAL } from './OfferGeneratorConfigUseCases';

export interface SendQueueControlDeps {
  pauses: ISendingPauseStore;
  dispatches: IOfferDispatchRepository;
  configs: IOfferGeneratorConfigRepository;
  now?: () => Date;
  rand?: () => number;
}

export interface SendingPauseStateDTO {
  /** ISO; null = envios ativos. */
  sendingPausedAt: string | null;
}

/**
 * Pausa global: nada do tenant sai (o claim do worker ignora o tenant), de qualquer sessão ou
 * origem. Captura e enfileiramento continuam; o que vencer na espera sai SKIPPED no envio.
 * Idempotente: pausar de novo mantém o instante original.
 */
export class PauseAllSendsUseCase {
  constructor(private readonly deps: Pick<SendQueueControlDeps, 'pauses' | 'now'>) {}

  async execute(input: { tenantId: string }): Promise<SendingPauseStateDTO> {
    // Atômico no banco: dois "pausar" concorrentes (duas abas) ficam com o mesmo instante
    const at = await this.deps.pauses.pauseIfActive(input.tenantId, (this.deps.now ?? (() => new Date()))());
    return { sendingPausedAt: at.toISOString() };
  }
}

/**
 * Retomar: libera o tenant e reespalha a fila de cada sessão a partir de agora (`respreadLane`):
 * o que venceu durante a pausa sai na ordem, com a cadência da configuração, sem rajada na prévia.
 * A cadência real continua garantida pelo claim (um envio por sessão por intervalo).
 */
export class ResumeAllSendsUseCase {
  constructor(private readonly deps: SendQueueControlDeps) {}

  async execute(input: { tenantId: string }): Promise<SendingPauseStateDTO> {
    const { tenantId } = input;
    // Já ativo (botão desatualizado em outra aba): não reespalha uma fila que está andando
    if (!(await this.deps.pauses.get(tenantId))) return { sendingPausedAt: null };
    await this.deps.pauses.set(tenantId, null);
    const now = (this.deps.now ?? (() => new Date()))();
    const config = await this.deps.configs.find(tenantId);
    const interval = {
      minMs: (config?.intervalMinSeconds ?? DEFAULT_INTERVAL.min) * 1000,
      maxMs: (config?.intervalMaxSeconds ?? DEFAULT_INTERVAL.max) * 1000,
    };
    for (const sessionId of await this.deps.dispatches.openSessionIds(tenantId)) {
      const lane = await this.deps.dispatches.laneState(tenantId, sessionId, now);
      const moved = respreadLane(lane.open.map((d) => ({ id: d.id, notBefore: d.notBefore })), { now, lastClaimedAt: lane.lastClaimedAt, interval, rand: this.deps.rand });
      if (moved.length > 0) await this.deps.dispatches.rescheduleMany(tenantId, moved);
    }
    return { sendingPausedAt: null };
  }
}
