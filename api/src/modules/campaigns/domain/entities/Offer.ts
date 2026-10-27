import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { OfferStatus } from '../enums/OfferStatus';
import type { OfferAudience } from '../enums/OfferAudience';
import type { OfferOrigin } from '../enums/OfferOrigin';

/** Oferta gerada a partir de um link de produto. Preços em centavos; `imageUrl` aponta pro media store. */
export interface Offer {
  id: string;
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
  textEdited: boolean;
  /** Código do cupom (até 40 caracteres), ou null. */
  coupon: string | null;
  audience: OfferAudience;
  /** Menciona todos os participantes ao enviar em grupo. */
  mentionAll: boolean;
  /** Envia "digitando…" antes da mensagem. */
  simulateTyping: boolean;
  /** Segundos de "digitando…" (1–30). */
  typingSeconds: number;
  /** Início agendado dos disparos; null = começa ao disparar. */
  scheduledAt: Date | null;
  /** Gerador (painel) ou monitoramento de grupos. */
  origin: OfferOrigin;
  /** Validade: envio que chegar a sair depois disso é pulado (OFFER_EXPIRED). */
  expiresAt: Date | null;
  status: OfferStatus;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}
