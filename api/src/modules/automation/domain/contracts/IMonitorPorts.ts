import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { OfferAudience } from '../../../campaigns/domain/enums/OfferAudience';

/** Link de afiliado DO TENANT para um link de produto de terceiro (adapter: módulo campaigns). */
export type TenantLinkResult =
  | { kind: 'unsupported' }
  | { kind: 'credential_missing'; provider: AffiliateProvider }
  /** Loja recusou a credencial: pausada até o usuário reconfigurar (sem rede). */
  | { kind: 'credential_rejected'; provider: AffiliateProvider; since: Date }
  | { kind: 'failed'; provider: AffiliateProvider | null; code: string }
  | { kind: 'ok'; provider: AffiliateProvider; sourceUrl: string; affiliateUrl: string };

export interface ITenantLinkBuilder {
  build(tenantId: string, href: string): Promise<TenantLinkResult>;
}

export interface QueueOfferInput {
  tenantId: string;
  /** Destinos na ordem de envio; cada um na faixa da sua sessão (sessão cruzada = outra sessão). */
  destinations: { conversationId: string; sessionId: string }[];
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

/** Dados do produto para montar a oferta (adapter: `ResolveProductDataUseCase` do módulo campaigns). */
export interface MonitorProductData {
  title: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  /** URL externa da foto (marketplace), ainda fora do media store. */
  imageUrl: string | null;
}
export interface IMonitorProductReader {
  /** null = nada encontrado. Nunca lança por falta de dado ou rede; erro inesperado sobe. */
  read(tenantId: string, provider: AffiliateProvider, sourceUrl: string): Promise<MonitorProductData | null>;
}

/** Texto da oferta pelo modelo fixo ou pela IA (adapter: `OfferTextComposer`). */
export interface MonitorComposeInput {
  tenantId: string;
  audience: OfferAudience;
  title: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  coupon: string | null;
  affiliateUrl: string;
}
export interface IMonitorTextComposer {
  compose(input: MonitorComposeInput): Promise<{ text: string; aiFallback: boolean; aiErrorCode?: string }>;
}

/** Foto do produto para o media store (adapter: fetcher + store do módulo campaigns). */
export interface IMonitorImageStore {
  /** URL no store ou null (host fora da allowlist, não-imagem, falha). Nunca lança. */
  store(externalUrl: string): Promise<string | null>;
}

/** Estado das credenciais do tenant, para o aviso do monitoramento (adapter: repositório de integrations). */
export interface CredentialState {
  provider: AffiliateProvider;
  /** ACTIVE, com ID público e com o que a loja exige (secret / sessão). */
  usable: boolean;
  rejectedAt: Date | null;
  rejectedCode: string | null;
}
export interface ICredentialStateSource {
  listStates(tenantId: string): Promise<CredentialState[]>;
}

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
