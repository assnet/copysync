import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { IOfferDispatchRepository } from '../../domain/contracts/IOfferDispatchRepository';
import type { IOfferRepository } from '../../domain/contracts/IOfferRepository';
import type { OfferOrigin } from '../../domain/enums/OfferOrigin';
import { appendToLanes, laneGapMs } from '../../domain/services/appendToLanes';
import { scheduleDispatches } from '../../domain/services/scheduleDispatches';
import { OfferAlreadySentError } from '../../../../shared/errors/internal/OfferErrors';

export interface EnqueueOfferInput {
  tenantId: string;
  /** Sessão que envia (todos os destinos são dela). */
  sessionId: string;
  /** Conversas de grupo, na ordem de envio. */
  conversationIds: string[];
  origin: OfferOrigin;
  provider: AffiliateProvider;
  sourceUrl: string;
  affiliateUrl: string;
  title: string | null;
  text: string;
  imageUrl: string | null;
  coupon: string | null;
  mentionAll: boolean;
  simulateTyping: boolean;
  typingSeconds: number;
  /** 1º envio não antes disso (a fila da sessão pode empurrar para depois). */
  startAt: Date;
  /** Validade: nada sai depois disso. */
  expiresAt: Date | null;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  /**
   * Chave idempotente (ex.: `captured:<id>`). Já existe oferta com ela: devolve essa oferta e não
   * cria outra (reprocessar depois de uma queda não posta duas vezes).
   */
  sourceKey?: string;
}

export type EnqueueOfferResult =
  | { kind: 'queued'; offerId: string; firstSendAt: Date }
  /** A fila da sessão empurraria o 1º envio para depois da validade: nada foi criado. */
  | { kind: 'expired'; firstSendAt: Date };

export interface EnqueueOfferDeps {
  offers: IOfferRepository;
  dispatches: IOfferDispatchRepository;
  rand?: () => number;
}

/**
 * Oferta pronta (texto, link do tenant, destinos) vinda de outro módulo (ex.: monitoramento de
 * grupos) → oferta SENDING na fila de envio da sessão, com o mesmo agendamento por faixa do
 * gerador (docs/fila-de-envio.md). Quem envia é o worker; validade checada lá também.
 */
export class EnqueueOfferUseCase {
  constructor(private readonly deps: EnqueueOfferDeps) {}

  async execute(input: EnqueueOfferInput): Promise<EnqueueOfferResult> {
    const { tenantId, sessionId, conversationIds } = input;
    if (conversationIds.length === 0) throw new Error('EnqueueOfferUseCase: no destinations');
    if (input.sourceKey) {
      const existing = await this.deps.offers.findBySourceKey(tenantId, input.sourceKey);
      if (existing) {
        const first = (await this.deps.dispatches.listByOffer(existing.id, tenantId))
          .reduce<Date | null>((min, d) => (!min || d.notBefore < min ? d.notBefore : min), null);
        return { kind: 'queued', offerId: existing.id, firstSendAt: first ?? input.startAt };
      }
    }

    const interval = { minMs: input.intervalMinSeconds * 1000, maxMs: input.intervalMaxSeconds * 1000 };
    const planned = scheduleDispatches(conversationIds.length, input.startAt, interval, this.deps.rand);
    const tails = await this.deps.dispatches.laneTails(tenantId, [sessionId], planned[0]!);
    const slots = tails.size === 0
      ? planned
      : appendToLanes(planned.map((notBefore) => ({ sessionId, notBefore })), tails, laneGapMs(interval, this.deps.rand));
    const firstSendAt = slots[0]!;
    if (input.expiresAt && firstSendAt.getTime() >= input.expiresAt.getTime()) return { kind: 'expired', firstSendAt };

    const offer = await this.deps.offers.create({
      tenantId,
      provider: input.provider,
      sourceUrl: input.sourceUrl,
      productRef: null,
      title: input.title,
      priceCents: null,
      originalPriceCents: null,
      imageUrl: input.imageUrl,
      affiliateUrl: input.affiliateUrl,
      attributionVerified: true,
      text: input.text,
      coupon: input.coupon,
      audience: 'STANDARD',
      scheduledAt: null,
      createdById: null,
      origin: input.origin,
      expiresAt: input.expiresAt,
      mentionAll: input.mentionAll,
      simulateTyping: input.simulateTyping,
      typingSeconds: input.typingSeconds,
      sourceKey: input.sourceKey ?? null,
    });
    const created = await this.deps.dispatches.startSending(
      offer.id,
      tenantId,
      { mentionAll: input.mentionAll },
      conversationIds.map((conversationId, i) => ({ conversationId, sessionId, notBefore: slots[i]!, gapSeconds: input.intervalMinSeconds })),
    );
    // Oferta acabou de nascer DRAFT: só falha se algo a mudou no meio (não deveria)
    if (!created) throw new OfferAlreadySentError(offer.id);
    return { kind: 'queued', offerId: offer.id, firstSendAt };
  }
}
