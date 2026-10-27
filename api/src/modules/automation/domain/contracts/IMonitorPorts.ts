import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';

/** Link de afiliado DO TENANT para um link de produto de terceiro (adapter: módulo campaigns). */
export type TenantLinkResult =
  | { kind: 'unsupported' }
  | { kind: 'credential_missing'; provider: AffiliateProvider }
  | { kind: 'failed'; provider: AffiliateProvider | null; code: string }
  | { kind: 'ok'; provider: AffiliateProvider; sourceUrl: string; affiliateUrl: string };

export interface ITenantLinkBuilder {
  build(tenantId: string, href: string): Promise<TenantLinkResult>;
}

export interface QueueOfferInput {
  tenantId: string;
  sessionId: string;
  conversationIds: string[];
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
  startAt: Date;
  expiresAt: Date;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  /** Idempotência: a mesma captura nunca vira duas ofertas. */
  sourceKey: string;
}

export type QueueOfferResult =
  | { kind: 'queued'; offerId: string; firstSendAt: Date }
  | { kind: 'expired'; firstSendAt: Date };

/** Fila de envio por sessão (adapter: módulo campaigns, origem MONITORING). */
export interface IOfferQueue {
  enqueue(input: QueueOfferInput): Promise<QueueOfferResult>;
}

/** Grupos da sessão no WhatsApp + conversa do chat (adapter: campaigns + chat). */
export interface IMonitorGroupDirectory {
  /** Só grupo de que a sessão participa; cria a conversa se faltar. Lança NotFound/Engine*. */
  ensureGroup(tenantId: string, sessionId: string, groupJid: string): Promise<{ conversationId: string }>;
  /** Liga o download automático de mídia da conversa (sem isso a foto não chega ao store). */
  enableMediaDownload(tenantId: string, conversationId: string): Promise<void>;
}
