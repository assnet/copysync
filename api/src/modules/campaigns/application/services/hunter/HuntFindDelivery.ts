import type { IOfferHuntFindRepository } from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import type { IOfferHuntRunRepository } from '../../../domain/contracts/hunter/IOfferHuntRunRepository';
import type { IOfferHunterSettingsRepository } from '../../../domain/contracts/hunter/IOfferHunterSettingsRepository';
import type { IOfferGeneratorConfigRepository } from '../../../domain/contracts/IOfferGeneratorConfigRepository';
import type { IHuntProviderRegistry } from '../../../domain/contracts/hunter/IHuntProviderAdapter';
import type { OfferHuntFind } from '../../../domain/hunter/OfferHunt';
import { DEFAULT_OFFER_IMAGE_MODE } from '../../../domain/enums/OfferImageMode';
import { OfferHuntDestinationRequiredError, OfferHuntResendPendingError } from '../../../../../shared/errors/internal/OfferHuntErrors';
import { AppError } from '../../../../../shared/errors/AppError';
import { OfferInvalidInputError } from '../../../../../shared/errors/internal/OfferErrors';
import { logger } from '../../../../../shared/logger/logger';
import type { EnqueueOfferUseCase } from '../../use-cases/EnqueueOfferUseCase';
import type { ResolveAffiliateProductUseCase } from '../../use-cases/ResolveAffiliateProductUseCase';
import type { ResolveProductDataUseCase } from '../../use-cases/ResolveProductDataUseCase';
import type { OfferTextComposer } from '../OfferTextComposer';
import { DEFAULT_INTERVAL } from '../../use-cases/OfferGeneratorConfigUseCases';

/** Idempotência do Enqueue: queda entre enfileirar e gravar `offerId` não reenvia. */
export const huntSourceKey = (findId: string) => `hunt:${findId}`;
/**
 * Reenvio: chave por número do reenvio (o claim dá o número). Retomar o MESMO reenvio reusa a chave e o
 * Enqueue (idempotente por `sourceKey`) devolve a oferta já criada, sem duplicar.
 */
export const huntResendSourceKey = (findId: string, number: number) => `hunt:${findId}:r${number}`;

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
  /** URL do produto pela marca do achado (nunca é buscada pelo caçador; só vai ao Resolve). */
  providers: Pick<IHuntProviderRegistry, 'get'>;
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
    const image = { stored: null as string | null };
    let queuedOfferId: string | null = null;
    try {
      const offerId = await this.enqueue(tenantId, find, destination, huntSourceKey(find.id), image);
      if (!offerId) return this.fail(tenantId, find, 'EXPIRED', null, image.stored);
      queuedOfferId = offerId;
      await this.deps.finds.transition(tenantId, find.id, ['APPROVED'], 'SENT', { offerId, failureReason: null });
      if (find.runId) await this.deps.runs.incrementSent(tenantId, find.runId);
      return { status: 'SENT', offerId };
    } catch (err) {
      if (queuedOfferId) return this.settleQueued(tenantId, find, queuedOfferId);
      const reason = err instanceof AppError ? err.code : 'DELIVERY_FAILED';
      return this.fail(tenantId, find, reason, err, image.stored);
    }
  }

  /**
   * Reenvio de achado já entregue: mesmo caminho (link do tenant regerado, preço/foto atuais, texto, Enqueue
   * `HUNTER`) com `sourceKey` do número do reenvio, para o destino atual. Não mexe no estado do achado: quem grava a oferta
   * nova é o chamador. Falha antes de enfileirar descarta a foto e lança o erro (código traduzido no painel).
   */
  async resend(tenantId: string, find: OfferHuntFind, destination: HuntDestination, number: number): Promise<string> {
    const image = { stored: null as string | null };
    try {
      const offerId = await this.enqueue(tenantId, find, destination, huntResendSourceKey(find.id, number), image);
      if (!offerId) throw new OfferHuntResendPendingError();
      return offerId;
    } catch (err) {
      if (image.stored) await this.deps.images.discardImage(image.stored);
      logger.warn({ tenantId, findId: find.id, code: err instanceof AppError ? err.code : 'DELIVERY_FAILED' }, 'offer hunt find resend failed');
      throw err;
    }
  }

  /** Resolve → texto → foto → Enqueue. null = Enqueue não enfileirou (expirada). `image.stored` = foto gravada. */
  private async enqueue(
    tenantId: string, find: OfferHuntFind, destination: HuntDestination, sourceKey: string, image: { stored: string | null },
  ): Promise<string | null> {
    const productUrl = this.deps.providers.get(find.provider).productUrl(find.productId);
    if (!productUrl) throw new OfferInvalidInputError('Invalid product id', 'productId');
    const resolved = await this.deps.affiliateProducts.execute(tenantId, productUrl, { riskScope: 'OFFER_HUNTER' });
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
    const storedImage = p.imageSourceUrl ? await this.deps.images.storeImage(p.imageSourceUrl) : null;
    image.stored = storedImage;
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
      sourceKey,
    });
    return res.kind === 'queued' ? res.offerId : null;
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
