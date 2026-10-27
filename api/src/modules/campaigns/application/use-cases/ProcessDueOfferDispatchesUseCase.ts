import type { IOfferRepository } from '../../domain/contracts/IOfferRepository';
import type { IOfferDispatchRepository, OfferDispatchResult } from '../../domain/contracts/IOfferDispatchRepository';
import type { IOfferMessageSender } from '../../domain/contracts/IOfferMessageSender';
import type { OfferDispatch } from '../../domain/entities/OfferDispatch';
import { AppError } from '../../../../shared/errors/AppError';
import { logger } from '../../../../shared/logger/logger';

/** SENDING sem resultado há mais que isso = worker morreu no meio; volta à fila. */
export const STALE_DISPATCH_MS = 5 * 60_000;
export const DISPATCH_BATCH_SIZE = 10;
/** Envio travado: vira FAILED SEND_TIMEOUT (sem retry — pode ter saído). */
export const DISPATCH_SEND_TIMEOUT_MS = 60_000;
/** Ofertas SENDING órfãs finalizadas por tick. */
export const FINALIZE_SWEEP_LIMIT = 20;

/**
 * Destino sumiu: pula sem marcar falha. NOT_FOUND = conversa (o chat lança NotFoundError
 * para ela); mídia ausente tem código próprio (MEDIA_NOT_FOUND → FAILED).
 */
const SKIP_CODES = new Set(['NOT_FOUND', 'SESSION_NOT_FOUND', 'OFFER_DESTINATION_UNAVAILABLE']);

class SendTimeoutError extends Error {}

export interface ProcessDueOfferDispatchesDeps {
  offers: IOfferRepository;
  dispatches: IOfferDispatchRepository;
  sender: IOfferMessageSender;
  now?: () => Date;
  batchSize?: number;
  sendTimeoutMs?: number;
}

/**
 * Um tick do worker (OFFER-08). Cross-tenant no claim; daqui em diante tudo volta a filtrar
 * pelo `tenantId` do envio. Um envio por vez (o espaçamento já vem do `notBefore`), cada um
 * isolado: erro de banco num envio não derruba os demais.
 *
 * Posse por `claimToken`: renovada antes de cada envio, exigida no resultado. Resíduo
 * at-least-once: queda entre o envio e o `markResult` deixa SENDING sem `chatMessageId`, que
 * volta à fila após STALE_DISPATCH_MS e pode sair duas vezes.
 */
export class ProcessDueOfferDispatchesUseCase {
  constructor(private readonly deps: ProcessDueOfferDispatchesDeps) {}

  async execute(): Promise<{ processed: number }> {
    const { dispatches } = this.deps;
    const now = (this.deps.now ?? (() => new Date()))();

    await dispatches.releaseStale(new Date(now.getTime() - STALE_DISPATCH_MS));
    const due = await dispatches.claimDue(now, this.deps.batchSize ?? DISPATCH_BATCH_SIZE);

    for (const dispatch of due) {
      try {
        await this.processOne(dispatch);
      } catch (err) {
        // Envio fica SENDING; releaseStale devolve à fila
        logger.error({ err: (err as Error)?.name, dispatchId: dispatch.id, tenantId: dispatch.tenantId }, 'offer dispatch processing failed');
      }
    }
    await this.sweepOrphanOffers();
    return { processed: due.length };
  }

  private async processOne(dispatch: OfferDispatch): Promise<void> {
    const { offers, dispatches } = this.deps;
    const { id, tenantId, offerId, claimToken } = dispatch;
    if (!claimToken) return;

    // Renova a posse; se outro worker reivindicou, não envia
    if (!(await dispatches.touchClaim(id, claimToken))) {
      logger.warn({ dispatchId: id, offerId, tenantId }, 'offer dispatch claim lost');
      return;
    }

    const offer = await offers.findById(offerId, tenantId);
    if (!offer) {
      await dispatches.markResult(id, tenantId, claimToken, { status: 'SKIPPED', failureReason: 'OFFER_NOT_FOUND' });
      return;
    }

    let result: OfferDispatchResult;
    try {
      const sent = await this.sendWithTimeout({
        tenantId,
        conversationId: dispatch.conversationId,
        text: offer.text,
        imageUrl: offer.imageUrl,
        mentionAll: offer.mentionAll,
        simulateTyping: offer.simulateTyping,
        typingSeconds: offer.typingSeconds,
      });
      result = { status: 'SENT', chatMessageId: sent.chatMessageId };
    } catch (err) {
      result = toFailure(err);
      // Sem texto da oferta no log
      logger.warn({ dispatchId: id, offerId, tenantId, code: result.failureReason }, 'offer dispatch not sent');
    }

    const marked = await dispatches.markResult(id, tenantId, claimToken, result);
    if (!marked) logger.warn({ dispatchId: id, offerId, tenantId }, 'offer dispatch no longer owned');

    await this.finalizeIfDone(offerId, tenantId);
  }

  /** O envio pode seguir em segundo plano após o timeout; por isso SEND_TIMEOUT não reenvia. */
  private async sendWithTimeout(input: Parameters<IOfferMessageSender['send']>[0]): Promise<{ chatMessageId: string }> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      // A digitação acontece dentro do envio: estende o prazo para ela não virar SEND_TIMEOUT
      const typingMs = input.simulateTyping ? input.typingSeconds * 1000 : 0;
      timer = setTimeout(() => reject(new SendTimeoutError()), (this.deps.sendTimeoutMs ?? DISPATCH_SEND_TIMEOUT_MS) + typingMs);
    });
    try {
      return await Promise.race([this.deps.sender.send(input), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Oferta SENDING sem envio aberto (finalize perdido por erro/queda) → fecha. */
  private async sweepOrphanOffers(): Promise<void> {
    try {
      const orphans = await this.deps.dispatches.findSendingWithoutOpenDispatches(FINALIZE_SWEEP_LIMIT);
      for (const o of orphans) {
        try {
          await this.finalizeIfDone(o.id, o.tenantId);
        } catch (err) {
          logger.error({ err: (err as Error)?.name, offerId: o.id, tenantId: o.tenantId }, 'offer finalize failed');
        }
      }
    } catch (err) {
      logger.error({ err: (err as Error)?.name }, 'offer finalize sweep failed');
    }
  }

  /** Sem envio aberto: SENT se ao menos um saiu, senão FAILED. */
  private async finalizeIfDone(offerId: string, tenantId: string): Promise<void> {
    const { offers, dispatches } = this.deps;
    if ((await dispatches.countOpen(offerId, tenantId)) > 0) return;
    const counts = await dispatches.countByStatus(offerId, tenantId);
    await offers.transitionStatus(offerId, tenantId, ['SENDING'], counts.SENT > 0 ? 'SENT' : 'FAILED');
  }
}

function toFailure(err: unknown): Extract<OfferDispatchResult, { failureReason: string }> {
  if (err instanceof SendTimeoutError) return { status: 'FAILED', failureReason: 'SEND_TIMEOUT' };
  if (err instanceof AppError) {
    return { status: SKIP_CODES.has(err.code) ? 'SKIPPED' : 'FAILED', failureReason: err.code };
  }
  logger.error({ err: (err as Error)?.name }, 'offer dispatch unexpected error');
  return { status: 'FAILED', failureReason: 'MESSAGE_SEND_FAILED' };
}
