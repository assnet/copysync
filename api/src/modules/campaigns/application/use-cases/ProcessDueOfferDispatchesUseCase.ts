import type { IOfferRepository } from '../../domain/contracts/IOfferRepository';
import type { IOfferDispatchRepository, OfferDispatchResult } from '../../domain/contracts/IOfferDispatchRepository';
import type { IOfferMessageSender } from '../../domain/contracts/IOfferMessageSender';
import type { OfferDispatch } from '../../domain/entities/OfferDispatch';
import { AppError } from '../../../../shared/errors/AppError';
import { ConcurrentOfferDispatchExecutor, type OfferSendSlot } from '../services/ConcurrentOfferDispatchExecutor';
import { logger } from '../../../../shared/logger/logger';

/** SENDING sem resultado há mais que isso = worker morreu no meio; volta à fila. */
export const STALE_DISPATCH_MS = 5 * 60_000;
export const DISPATCH_BATCH_SIZE = 10;
/** Envio travado: vira FAILED SEND_TIMEOUT (sem retry — pode ter saído). */
export const DISPATCH_SEND_TIMEOUT_MS = 60_000;
/** Sessão fora do ar na vez do envio: tenta de novo depois disso, segurando a vez da sessão. */
export const OFFLINE_RETRY_MS = 60_000;
/** Esperando a sessão reconectar há mais que isso: desiste dos envios atrasados da sessão. */
export const OFFLINE_MAX_WAIT_MS = 6 * 3_600_000;
/**
 * Erro que o envio levanta ANTES de gravar ou mandar qualquer coisa (engine ausente; socket fechado
 * em `createOutboundMessageId`/`sendMediaMessage`): reenviar depois não duplica. `ENGINE_NOT_READY`
 * NÃO entra: é também o código genérico do tradutor de erro do envio de texto (pode ter saído).
 */
const OFFLINE_CODES = new Set(['SESSION_NOT_CONNECTED']);
/**
 * Conta pediu para esperar (Telegram `FLOOD_WAIT`, `meta.seconds`): recusado antes de sair, então
 * reenviar não duplica. Volta à fila com `notBefore = agora + seconds` (+ folga) segurando a vez da
 * sessão, pelo mesmo caminho da sessão fora do ar, mas com relógio próprio: `failureReason` =
 * FLOOD_WAIT_REASON enquanto QUEUED marca que `waitingSessionSince` conta o flood, não a queda.
 * Flood acumulado (desde o 1º, incluindo a espera pedida) ≥ FLOOD_MAX_WAIT_MS → FAILED.
 */
const FLOOD_WAIT_REASON = 'TELEGRAM_FLOOD_WAIT';
const FLOOD_WAIT_CODES = new Set([FLOOD_WAIT_REASON]);
export const FLOOD_WAIT_MARGIN_MS = 1_000;
export const FLOOD_MAX_WAIT_MS = 6 * 3_600_000;

/** Ofertas SENDING órfãs finalizadas por tick. */
export const FINALIZE_SWEEP_LIMIT = 20;

/**
 * Destino sumiu: pula sem marcar falha. NOT_FOUND = conversa (o chat lança NotFoundError
 * para ela); mídia ausente tem código próprio (MEDIA_NOT_FOUND → FAILED).
 */
const SKIP_CODES = new Set(['NOT_FOUND', 'SESSION_NOT_FOUND', 'OFFER_DESTINATION_UNAVAILABLE']);

class SendTimeoutError extends Error {}

/**
 * Contexto opcional de uma rodada. `signal` abortado = parada do worker: nenhum claim nem envio
 * novo começa; item já reivindicado e não iniciado fica SENDING e volta pelo `releaseStale`. Envio
 * já iniciado termina e grava resultado/token. Sem sinal = comportamento de sempre.
 */
export interface OfferDispatchRunContext {
  signal?: AbortSignal;
  /**
   * Chamadas simultâneas ao sender (`OFFER_DISPATCH_CONCURRENCY`, entrega B). Ausente/1 = caminho
   * serial de sempre. 2 = executor por vagas (`ConcurrentOfferDispatchExecutor`); só com etapas
   * independentes (validado na composição do worker).
   */
  concurrency?: OfferDispatchConcurrency;
}

export type OfferDispatchConcurrency = 1 | 2;

/** Desfecho de um item, só para o log de observação. */
type ItemOutcome = { status: string; code: string | null; sendMs: number | null };

export interface ProcessDueOfferDispatchesDeps {
  offers: IOfferRepository;
  dispatches: IOfferDispatchRepository;
  sender: IOfferMessageSender;
  now?: () => Date;
  /** Relógio monotônico só para durações do log (padrão `Date.now`). */
  clock?: () => number;
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
  /** Vagas do modo 2: vivem entre rodadas (promise do sender ainda pendente). Criado no 1º uso. */
  private concurrent: ConcurrentOfferDispatchExecutor | null = null;

  constructor(private readonly deps: ProcessDueOfferDispatchesDeps) {}

  /** Chamadas ao sender ainda pendentes no modo 2 (0 no modo serial). */
  unsettledSenders(): { unsettledSenders: number; oldestUnsettledMs: number | null } {
    return this.concurrent?.unsettled() ?? { unsettledSenders: 0, oldestUnsettledMs: null };
  }

  async execute(ctx: OfferDispatchRunContext = {}): Promise<{ processed: number }> {
    const { dispatches } = this.deps;
    const { signal } = ctx;
    if (signal?.aborted) return { processed: 0 };
    const now = (this.deps.now ?? (() => new Date()))();

    await dispatches.releaseStale(new Date(now.getTime() - STALE_DISPATCH_MS));
    // Vencidos fecham em lote antes do claim: não ocupam a cabeça da faixa um por tick
    await dispatches.skipExpired(now);
    if (signal?.aborted) return { processed: 0 };
    if (ctx.concurrency === 2) return this.executeConcurrent(signal);
    const due = await dispatches.claimDue(now, this.deps.batchSize ?? DISPATCH_BATCH_SIZE);

    for (let i = 0; i < due.length; i++) {
      const dispatch = due[i]!;
      // Parada: o resto do lote fica SENDING sem envio e o releaseStale devolve (não é falha)
      if (signal?.aborted) {
        logger.info({ left: due.length - i }, 'offer dispatches left for recovery at stop');
        break;
      }
      try {
        await this.processOne(dispatch, now, signal);
      } catch (err) {
        // Envio fica SENDING; releaseStale devolve à fila
        logger.error({ err: (err as Error)?.name, dispatchId: dispatch.id, tenantId: dispatch.tenantId }, 'offer dispatch processing failed');
      }
    }
    if (!signal?.aborted) await this.sweepOrphanOffers();
    return { processed: due.length };
  }

  /**
   * Modo 2 (design B): ondas do tamanho das vagas livres, `now` novo por claim, até
   * DISPATCH_BATCH_SIZE itens, excluindo sessões já escolhidas na rodada e sessões com sender
   * pendente (mesmo após SEND_TIMEOUT e o hold de 120 s). Cada item segue o mesmo `handleOne`.
   */
  private async executeConcurrent(signal?: AbortSignal): Promise<{ processed: number }> {
    this.concurrent ??= new ConcurrentOfferDispatchExecutor({
      capacity: 2,
      maxItemsPerRound: this.deps.batchSize ?? DISPATCH_BATCH_SIZE,
      clock: this.deps.clock,
    });
    const nowFn = this.deps.now ?? (() => new Date());
    const claimedAt = new Map<string, Date>();
    const result = await this.concurrent.runRound({
      signal,
      claim: async (limit, excludeSessionIds) => {
        const now = nowFn();
        const due = await this.deps.dispatches.claimDue(now, limit, { excludeSessionIds });
        for (const d of due) claimedAt.set(d.id, now);
        return due;
      },
      process: (d, slot) => this.processOne(d, claimedAt.get(d.id) ?? nowFn(), signal, slot),
    });
    if (!signal?.aborted) await this.sweepOrphanOffers();
    return result;
  }

  private async processOne(dispatch: OfferDispatch, now: Date, signal?: AbortSignal, slot?: OfferSendSlot): Promise<void> {
    const startedAt = (this.deps.now ?? (() => new Date()))();
    const outcome = await this.handleOne(dispatch, now, signal, slot);
    if (outcome) observeDispatch(dispatch, outcome, startedAt);
  }

  /** null = nada aconteceu com o item (sem token, posse perdida antes, parada antes do envio). */
  private async handleOne(dispatch: OfferDispatch, now: Date, signal?: AbortSignal, slot?: OfferSendSlot): Promise<ItemOutcome | null> {
    const { offers, dispatches } = this.deps;
    const { id, tenantId, offerId, claimToken } = dispatch;
    if (!claimToken) return null;

    // Renova a posse; se outro worker reivindicou, não envia
    if (!(await dispatches.touchClaim(id, claimToken))) {
      logger.warn({ dispatchId: id, offerId, tenantId }, 'offer dispatch claim lost');
      return { status: 'CLAIM_LOST', code: null, sendMs: null };
    }

    const offer = await offers.findById(offerId, tenantId);
    if (!offer) {
      await dispatches.markResult(id, tenantId, claimToken, { status: 'SKIPPED', failureReason: 'OFFER_NOT_FOUND' });
      return { status: 'SKIPPED', code: 'OFFER_NOT_FOUND', sendMs: null };
    }
    // Oferta/cupom vencido não sai (validade definida por quem criou, ex.: monitoramento). Relógio
    // de agora, não do início do tick: o lote pode levar minutos
    const sendNow = (this.deps.now ?? (() => new Date()))();
    if (offer.expiresAt && offer.expiresAt.getTime() <= Math.max(now.getTime(), sendNow.getTime())) {
      await dispatches.markResult(id, tenantId, claimToken, { status: 'SKIPPED', failureReason: 'OFFER_EXPIRED' });
      await this.finalizeIfDone(offerId, tenantId);
      return { status: 'SKIPPED', code: 'OFFER_EXPIRED', sendMs: null };
    }

    // Último ponto antes do efeito: parada aqui não envia; SENDING volta pelo releaseStale
    if (signal?.aborted) {
      logger.info({ dispatchId: id, offerId, tenantId }, 'offer dispatch left for recovery at stop');
      return null;
    }

    let result: OfferDispatchResult;
    const clock = this.deps.clock ?? Date.now;
    const sendStarted = clock();
    let sendMs: number | null = null;
    try {
      const sent = await this.sendWithTimeout({
        tenantId,
        conversationId: dispatch.conversationId,
        text: offer.text,
        imageUrl: offer.imageUrl,
        imageMode: offer.imageMode,
        title: offer.title,
        affiliateUrl: offer.affiliateUrl,
        mentionAll: offer.mentionAll,
        simulateTyping: offer.simulateTyping,
        typingSeconds: offer.typingSeconds,
      }, slot);
      sendMs = clock() - sendStarted;
      result = { status: 'SENT', chatMessageId: sent.chatMessageId };
    } catch (err) {
      sendMs = clock() - sendStarted;
      if (err instanceof AppError && OFFLINE_CODES.has(err.code) && dispatch.sessionId) {
        await this.waitForSession(dispatch, now);
        return { status: 'WAITING_SESSION', code: err.code, sendMs };
      }
      const floodMs = err instanceof AppError && FLOOD_WAIT_CODES.has(err.code) ? floodWaitMs(err) : null;
      if (floodMs !== null && dispatch.sessionId && (await this.waitForFlood(dispatch, now, floodMs))) {
        return { status: 'RATE_LIMITED', code: FLOOD_WAIT_REASON, sendMs };
      }
      result = toFailure(err);
      // Sem texto da oferta no log
      logger.warn({ dispatchId: id, offerId, tenantId, code: result.failureReason }, 'offer dispatch not sent');
    }

    const marked = await dispatches.markResult(id, tenantId, claimToken, result);
    if (!marked) logger.warn({ dispatchId: id, offerId, tenantId }, 'offer dispatch no longer owned');

    await this.finalizeIfDone(offerId, tenantId);
    return { status: marked ? result.status : 'NOT_OWNED', code: 'failureReason' in result ? result.failureReason : null, sendMs };
  }

  /**
   * Sessão fora do ar (queda silenciosa, reconexão, deploy): o envio volta para a fila e segura a
   * vez da sessão em vez de virar FAILED. Fora do ar por mais de OFFLINE_MAX_WAIT_MS: os envios
   * atrasados da sessão falham juntos (todos esperaram o mesmo tempo).
   */
  private async waitForSession(dispatch: OfferDispatch, now: Date): Promise<void> {
    const { dispatches } = this.deps;
    const { id, tenantId, offerId, claimToken, sessionId } = dispatch;
    // Vinha esperando flood: a queda começa a contar agora (o flood não consome a janela de 6 h)
    const since = isFloodWait(dispatch) ? now : dispatch.waitingSessionSince ?? now;
    if (now.getTime() - since.getTime() >= OFFLINE_MAX_WAIT_MS) {
      await dispatches.markResult(id, tenantId, claimToken!, { status: 'FAILED', failureReason: 'SESSION_NOT_CONNECTED' });
      // Vencidos da sessão e o resto desta oferta: nenhum ganha outra janela de 6 h
      const failed = await dispatches.failOverdueInSession(tenantId, sessionId!, now, 'SESSION_NOT_CONNECTED', offerId);
      logger.warn({ dispatchId: id, offerId, tenantId, sessionId, failed }, 'offer dispatch gave up waiting for session');
      await this.finalizeIfDone(offerId, tenantId);
      return;
    }
    const deferred = await dispatches.deferForOfflineSession(id, tenantId, claimToken!, new Date(now.getTime() + OFFLINE_RETRY_MS), since);
    // Oferta parada/finalizada no meio: fica SENDING e o releaseStale fecha como CANCELLED
    if (deferred) logger.info({ dispatchId: id, offerId, tenantId, sessionId }, 'offer dispatch waiting for session to reconnect');
  }

  /**
   * Rate limit da conta: volta à fila para depois da espera pedida, mantendo a vez da sessão.
   * false = teto de flood acumulado estourado (quem chama grava FAILED TELEGRAM_FLOOD_WAIT e os
   * atrasados da sessão falham junto, como na desistência da sessão fora do ar).
   */
  private async waitForFlood(dispatch: OfferDispatch, now: Date, waitMs: number): Promise<boolean> {
    const { id, tenantId, offerId, claimToken, sessionId } = dispatch;
    const sendNow = (this.deps.now ?? (() => new Date()))();
    const at = Math.max(now.getTime(), sendNow.getTime());
    // Relógio do flood: só herda `waitingSessionSince` se a espera anterior também era flood
    const since = isFloodWait(dispatch) && dispatch.waitingSessionSince ? dispatch.waitingSessionSince : new Date(at);
    if (at - since.getTime() + waitMs >= FLOOD_MAX_WAIT_MS) {
      const failed = await this.deps.dispatches.failOverdueInSession(tenantId, sessionId!, now, FLOOD_WAIT_REASON, offerId);
      logger.warn({ dispatchId: id, offerId, tenantId, sessionId, waitMs, failed }, 'offer dispatch gave up on rate limit');
      return false;
    }
    const retryAt = new Date(at + waitMs + FLOOD_WAIT_MARGIN_MS);
    const deferred = await this.deps.dispatches.deferForOfflineSession(id, tenantId, claimToken!, retryAt, since, FLOOD_WAIT_REASON);
    if (deferred) logger.info({ dispatchId: id, offerId, tenantId, sessionId, waitMs }, 'offer dispatch rate limited, rescheduled');
    return true;
  }

  /** O envio pode seguir em segundo plano após o timeout; por isso SEND_TIMEOUT não reenvia. */
  private async sendWithTimeout(input: Parameters<IOfferMessageSender['send']>[0], slot?: OfferSendSlot): Promise<{ chatMessageId: string }> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      // A digitação acontece dentro do envio: estende o prazo para ela não virar SEND_TIMEOUT
      const typingMs = input.simulateTyping ? input.typingSeconds * 1000 : 0;
      timer = setTimeout(() => reject(new SendTimeoutError()), (this.deps.sendTimeoutMs ?? DISPATCH_SEND_TIMEOUT_MS) + typingMs);
    });
    try {
      if (!slot) return await Promise.race([this.deps.sender.send(input), timeout]);
      // Modo 2: a vaga passa para a promise original ANTES do envio; erro síncrono vira rejeição
      let release!: () => void;
      slot.holdUntil(new Promise<void>((r) => { release = r; }));
      let send: Promise<{ chatMessageId: string }>;
      try {
        send = this.deps.sender.send(input);
      } catch (err) {
        send = Promise.reject(err);
      }
      send.then(release, release);
      return await Promise.race([send, timeout]);
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

  /**
   * Sem envio aberto: SENT se ao menos um saiu, senão FAILED. Vale também para PAUSED (pausa
   * com o último envio já saindo: nada para retomar). CANCELLED é final e não entra aqui.
   */
  private async finalizeIfDone(offerId: string, tenantId: string): Promise<void> {
    const { offers, dispatches } = this.deps;
    if ((await dispatches.countOpen(offerId, tenantId)) > 0) return;
    const counts = await dispatches.countByStatus(offerId, tenantId);
    await offers.transitionStatus(offerId, tenantId, ['SENDING', 'PAUSED'], counts.SENT > 0 ? 'SENT' : 'FAILED');
  }
}

/**
 * Um log por envio tratado (docs/fila-de-envio.md): `dispatchOverdueMs` = início real − `notBefore`
 * (espera planejada/janela/offline já está no `notBefore`; isto é só o atraso do worker), `sendMs` =
 * duração da chamada ao sender. Só IDs e códigos: sem texto, link, título ou erro bruto. Falha aqui
 * nunca muda o resultado do envio.
 */
function observeDispatch(d: OfferDispatch, o: ItemOutcome, startedAt: Date): void {
  try {
    logger.info({
      dispatchId: d.id, offerId: d.offerId, tenantId: d.tenantId, sessionId: d.sessionId,
      status: o.status, code: o.code, sendMs: o.sendMs,
      dispatchOverdueMs: Math.max(0, startedAt.getTime() - d.notBefore.getTime()),
    }, 'offer dispatch observed');
  } catch {
    // observação é melhor esforço
  }
}

/** Na fila esperando flood (motivo gravado no defer); o resto é espera de sessão fora do ar. */
function isFloodWait(d: OfferDispatch): boolean {
  return d.waitingSessionSince !== null && d.failureReason === FLOOD_WAIT_REASON;
}

/** Espera pedida pelo canal, em ms; ausente/inválida = null (vira falha comum). */
function floodWaitMs(err: AppError): number | null {
  const seconds = Number(err.meta?.seconds);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

function toFailure(err: unknown): Extract<OfferDispatchResult, { failureReason: string }> {
  if (err instanceof SendTimeoutError) return { status: 'FAILED', failureReason: 'SEND_TIMEOUT' };
  if (err instanceof AppError) {
    return { status: SKIP_CODES.has(err.code) ? 'SKIPPED' : 'FAILED', failureReason: err.code };
  }
  logger.error({ err: (err as Error)?.name }, 'offer dispatch unexpected error');
  return { status: 'FAILED', failureReason: 'MESSAGE_SEND_FAILED' };
}
