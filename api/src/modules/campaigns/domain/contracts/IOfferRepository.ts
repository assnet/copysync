import type { OfferOrigin } from '../enums/OfferOrigin';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { Offer } from '../entities/Offer';
import type { OfferStatus } from '../enums/OfferStatus';
import type { OfferAudience } from '../enums/OfferAudience';

export interface CreateOfferInput {
  tenantId: string;
  provider: AffiliateProvider;
  sourceUrl: string;
  productRef: string | null;
  title: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  imageUrl: string | null;
  affiliateUrl: string;
  attributionVerified: boolean;
  text: string;
  coupon: string | null;
  audience: OfferAudience;
  scheduledAt: Date | null;
  createdById: string | null;
  /** Padrão GENERATOR. */
  origin?: OfferOrigin;
  expiresAt?: Date | null;
  /** Única: criar duas vezes com a mesma chave falha. */
  sourceKey?: string | null;
  mentionAll?: boolean;
  simulateTyping?: boolean;
  typingSeconds?: number;
}

export interface DailyQuota {
  /** Chave do entitlement (vai no erro). */
  key: string;
  since: Date;
  limit: number;
}

/** Campos editáveis pelo operador antes do envio. */
export type OfferPatch = Partial<
  Pick<Offer, 'title' | 'priceCents' | 'originalPriceCents' | 'imageUrl' | 'text' | 'textEdited' | 'coupon' | 'audience' | 'mentionAll' | 'simulateTyping' | 'typingSeconds' | 'scheduledAt'>
>;

export type UpdateOfferResult =
  | { outcome: 'updated'; offer: Offer }
  | { outcome: 'not_found' }
  | { outcome: 'not_editable' }
  /** `expectedUpdatedAt` informado e a oferta mudou depois da leitura. */
  | { outcome: 'changed' };

/** Status em que a oferta ainda aceita edição. */
// Só rascunho: o envio sai de DRAFT; oferta FAILED é refeita por cópia (reenviar, P2).
export const EDITABLE_OFFER_STATUSES: readonly OfferStatus[] = ['DRAFT'];

export interface IOfferRepository {
  create(input: CreateOfferInput): Promise<Offer>;
  /** Oferta criada antes com esta chave idempotente, ou null. */
  findBySourceKey(tenantId: string, sourceKey: string): Promise<Offer | null>;
  /**
   * Cria só se o tenant ainda tem cota no dia: recontagem + criação serializadas por tenant
   * (lock transacional). Cota esgotada → PlanLimitReachedError(key, limit).
   */
  createWithinDailyLimit(input: CreateOfferInput, quota: DailyQuota): Promise<Offer>;
  findById(id: string, tenantId: string): Promise<Offer | null>;
  /**
   * Só EDITABLE_OFFER_STATUSES; update condicional atômico. Com `expectedUpdatedAt`, só grava se
   * a oferta não mudou desde a leitura (senão `changed`, sem sobrescrever).
   */
  update(id: string, tenantId: string, patch: OfferPatch, expectedUpdatedAt?: Date): Promise<UpdateOfferResult>;
  /** Base da cota diária do plano. */
  countCreatedSince(tenantId: string, since: Date): Promise<number>;
  /** Troca atômica de status; false se o status atual não está em `from`. */
  transitionStatus(id: string, tenantId: string, from: OfferStatus[], to: OfferStatus): Promise<boolean>;
}
