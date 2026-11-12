import type { IOfferHuntFindRepository } from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import type { IOfferHuntRunRepository } from '../../../domain/contracts/hunter/IOfferHuntRunRepository';
import type { IOfferHunterSettingsRepository } from '../../../domain/contracts/hunter/IOfferHunterSettingsRepository';
import type { IOfferGeneratorConfigRepository } from '../../../domain/contracts/IOfferGeneratorConfigRepository';
import type { OfferHuntFind } from '../../../domain/hunter/OfferHunt';
import { DEFAULT_OFFER_IMAGE_MODE } from '../../../domain/enums/OfferImageMode';
import { OfferHuntDestinationRequiredError } from '../../../../../shared/errors/internal/OfferHuntErrors';
import { AppError } from '../../../../../shared/errors/AppError';
import { logger } from '../../../../../shared/logger/logger';
import type { EnqueueOfferUseCase } from '../../use-cases/EnqueueOfferUseCase';
import type { ResolveAffiliateProductUseCase } from '../../use-cases/ResolveAffiliateProductUseCase';
import type { ResolveProductDataUseCase } from '../../use-cases/ResolveProductDataUseCase';
import type { OfferTextComposer } from '../OfferTextComposer';
import { DEFAULT_INTERVAL } from '../../use-cases/OfferGeneratorConfigUseCases';

/** URL do produto usada para pedir o link do tenant (nunca é buscada: a página cai em desafio). */
export const huntProductUrl = (goodsId: string) => `https://br.shein.com/product-p-${goodsId}.html`;
/** Idempotência do Enqueue: queda entre enfileirar e gravar `offerId` não reenvia. */
export const huntSourceKey = (findId: string) => `hunt:${findId}`;

export interface HuntDestination {
  sessionId: string;
  conversationId: string;
}

export type HuntDeliveryResult =
  | { status: 'SENT'; offerId: string }
  | { status: 'FAILED'; reason: string; error: unknown };

export interface HuntFindDeliveryDeps {
  finds: Pick<IOfferHuntFindRepository, 'transition'>;
  runs: Pick<IOfferHuntRunRepository, 'incrementSent'>;
  settings: Pick<IOfferHunterSettingsRepository, 'get'>;
  /** Link SEMPRE do tenant, cobrando só o aceite do caçador (`riskScope: 'OFFER_HUNTER'`). */
  affiliateProducts: Pick<ResolveAffiliateProductUseCase, 'execute'>;
  texts: Pick<OfferTextComposer, 'compose'>;
  images: Pick<ResolveProductDataUseCase, 'storeImage' | 'discardImage'>;
  enqueue: Pick<EnqueueOfferUseCase, 'execute'>;
  /** Intervalo do gerador (mesmo espaçamento da fila). */
  configs: Pick<IOfferGeneratorConfigRepository, 'find'>;
  now?: () => Date;
}

/**
 * Entrega de um achado (aprovação ou modo AUTO): link do tenant pelo Resolve, texto pelo compositor do
 * gerador (público STANDARD, o modelo fixo) e `EnqueueOfferUseCase` com `origin: 'HUNTER'` — quem cria a
 * `Offer` é o Enqueue. O achado precisa estar APPROVED (o chamador reivindicou); sai SENT ou FAILED.
 * Nunca loga link, título nem token; só ids e códigos.
 */
export class HuntFindDelivery {
  private readonly now: () => Date;
  constructor(private readonly deps: HuntFindDeliveryDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Destino salvo e completo, senão `OFFER_HUNT_DESTINATION_REQUIRED`. */
  async requireDestination(tenantId: string): Promise<HuntDestination> {
    const s = await this.deps.settings.get(tenantId);
    if (!s?.sessionId || !s.conversationId) throw new OfferHuntDestinationRequiredError();
    return { sessionId: s.sessionId, conversationId: s.conversationId };
  }

  async deliver(tenantId: string, find: OfferHuntFind, destination: HuntDestination): Promise<HuntDeliveryResult> {
    let storedImage: string | null = null;
    let queuedOfferId: string | null = null;
    try {
      const resolved = await this.deps.affiliateProducts.execute(tenantId, huntProductUrl(find.goodsId), { riskScope: 'OFFER_HUNTER' });
      const p = resolved.product;
      const title = p.title ?? find.title;
      const composed = await this.deps.texts.compose({
        tenantId,
        audience: 'STANDARD',
        title,
        priceCents: p.priceCents ?? find.priceCents,
        originalPriceCents: p.originalPriceCents ?? find.originalPriceCents,
        coupon: null,
        affiliateUrl: resolved.affiliateUrl,
      });
      storedImage = p.imageSourceUrl ? await this.deps.images.storeImage(p.imageSourceUrl) : null;
      const config = await this.deps.configs.find(tenantId);
      const res = await this.deps.enqueue.execute({
        tenantId,
        destinations: [destination],
        origin: 'HUNTER',
        provider: resolved.provider,
        sourceUrl: resolved.sourceUrl,
        affiliateUrl: resolved.affiliateUrl,
        title,
        text: composed.text,
        imageUrl: storedImage,
        coupon: null,
        mentionAll: false,
        imageMode: DEFAULT_OFFER_IMAGE_MODE,
        simulateTyping: false,
        typingSeconds: 15,
        startAt: this.now(),
        expiresAt: null,
        intervalMinSeconds: config?.intervalMinSeconds ?? DEFAULT_INTERVAL.min,
        intervalMaxSeconds: config?.intervalMaxSeconds ?? DEFAULT_INTERVAL.max,
        sourceKey: huntSourceKey(find.id),
      });
      if (res.kind !== 'queued') return this.fail(tenantId, find, 'EXPIRED', null, storedImage);
      queuedOfferId = res.offerId;
      await this.deps.finds.transition(tenantId, find.id, ['APPROVED'], 'SENT', { offerId: res.offerId, failureReason: null });
      if (find.runId) await this.deps.runs.incrementSent(tenantId, find.runId);
      return { status: 'SENT', offerId: res.offerId };
    } catch (err) {
      if (queuedOfferId) return this.settleQueued(tenantId, find, queuedOfferId);
      const reason = err instanceof AppError ? err.code : 'DELIVERY_FAILED';
      return this.fail(tenantId, find, reason, err, storedImage);
    }
  }

  /**
   * Oferta já enfileirada (a foto agora é dela: nunca descartar). Grava `offerId` + SENT de novo; se isso
   * também falhar, o erro sobe e o achado fica APPROVED sem `offerId` (retomável; o Enqueue é idempotente).
   */
  private async settleQueued(tenantId: string, find: OfferHuntFind, offerId: string): Promise<HuntDeliveryResult> {
    logger.warn({ tenantId, findId: find.id, offerId }, 'offer hunt find queued; retrying sent mark');
    await this.deps.finds.transition(tenantId, find.id, ['APPROVED'], 'SENT', { offerId, failureReason: null });
    return { status: 'SENT', offerId };
  }

  private async fail(tenantId: string, find: OfferHuntFind, reason: string, error: unknown, image: string | null): Promise<HuntDeliveryResult> {
    if (image) await this.deps.images.discardImage(image);
    await this.deps.finds.transition(tenantId, find.id, ['APPROVED'], 'FAILED', { failureReason: reason });
    logger.warn({ tenantId, findId: find.id, code: reason }, 'offer hunt find not delivered');
    return { status: 'FAILED', reason, error };
  }
}
