// ── Auth ─────────────────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
}

export interface TenantRef {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  tenants: TenantRef[];
}

export interface RefreshResponse {
  accessToken: string;
}

// ── Tenants ────────────────────────────────────────────────────────────────────

export interface TenantItem {
  id: string;
  name: string;
  slug: string;
  role: string;
  status: string;
}

export interface SwitchTenantResponse {
  accessToken: string;
  tenantId: string;
  tenantName: string;
}

// ── Sessions ───────────────────────────────────────────────────────────────────

export type SessionStatus =
  | 'PENDING'
  | 'CONNECTING'
  | 'AWAITING_QR'
  | 'AWAITING_PAIRING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'LOGGED_OUT'
  | 'FAILED';

export interface SessionItem {
  id: string;
  tenantId: string;
  name: string;
  engine: string;
  phone: string | null;
  externalRef: string | null;
  status: SessionStatus;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Foto do número conectado, servida pela API. */
  avatarUrl?: string | null;
}

export interface CreateSessionRequest {
  name: string;
  engine?: string;
}

export interface SessionListResponse {
  sessions: SessionItem[];
  total: number;
}

export interface SessionStatusResponse {
  sessionId: string;
  status: SessionStatus;
  phone: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
}

export interface ConnectSessionResponse {
  sessionId: string;
  status: SessionStatus;
  qrCode: string | null;
  pairingCode: string | null;
}

export interface SessionActionResponse {
  sessionId: string;
  status: SessionStatus;
}

export interface SessionQrResponse {
  sessionId: string;
  qrCode: string | null;
}

export interface SessionPairingCodeResponse {
  sessionId: string;
  pairingCode: string | null;
}

// ── Me ────────────────────────────────────────────────────────────────────────

export interface MeResponse {
  id: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  tenants: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
    status: string;
  }>;
}

// ── Account ───────────────────────────────────────────────────────────────────

export interface ChangePasswordRequest {
  newPassword: string;
  confirmPassword: string;
}

// ── Affiliate credentials ────────────────────────────────────────────────────

export type AffiliateProvider = 'SHOPEE' | 'MERCADO_LIVRE' | 'AMAZON';

export type AffiliateCredentialStatus = 'ACTIVE' | 'INACTIVE';

/** Credencial de afiliado como a API devolve: nunca traz o segredo nem a sessão em claro. */
export interface AffiliateCredentialItem {
  provider: AffiliateProvider;
  status: AffiliateCredentialStatus;
  publicIdentifier: string | null;
  publicIdentifierMasked: string | null;
  hasSecret: boolean;
  hasSession: boolean;
  sessionSyncedAt: string | null;
  lastValidatedAt: string | null;
  updatedAt: string;
}

export interface AffiliateCredentialListResponse {
  items: AffiliateCredentialItem[];
}

export interface UpsertAffiliateCredentialRequest {
  publicIdentifier: string;
  /** Ausente na edição = mantém o segredo já salvo. */
  secret?: string;
}

// ── Offer generator ──────────────────────────────────────────────────────────

export type OfferStatus = 'DRAFT' | 'SENDING' | 'SENT' | 'FAILED';

export type OfferDispatchStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

/** Envio da oferta para um destino. `failureReason` é um código interno (ex.: `SESSION_NOT_CONNECTED`). */
export interface OfferDispatchItem {
  id: string;
  conversationId: string;
  status: OfferDispatchStatus;
  notBefore: string;
  chatMessageId: string | null;
  failureReason: string | null;
  updatedAt: string;
}

/** Oferta como a API devolve: preços em centavos, datas ISO, nunca traz credencial. */
export interface OfferItem {
  id: string;
  provider: AffiliateProvider;
  sourceUrl: string;
  productRef: string | null;
  title: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  imageUrl: string | null;
  affiliateUrl: string;
  /** `false` quando o marketplace não confirma a atribuição pelo parâmetro do link. */
  attributionVerified: boolean;
  text: string;
  /** Texto editado à mão: mudar título/preço não o remonta mais. */
  textEdited: boolean;
  status: OfferStatus;
  createdAt: string;
  updatedAt: string;
  dispatches?: OfferDispatchItem[];
}

export interface GenerateOfferResponse {
  offer: OfferItem;
  /** Marketplace sem dados automáticos: o operador preenche título, preço e foto. */
  needsManualData: boolean;
}

export interface UpdateOfferRequest {
  title?: string | null;
  priceCents?: number | null;
  originalPriceCents?: number | null;
  text?: string;
  imageUploadId?: string;
}

export interface SendOfferResponse {
  offer: OfferItem;
  dispatches: OfferDispatchItem[];
}

/** `limit: null` = ilimitado. */
export interface OfferUsage {
  used: number;
  limit: number | null;
}

export interface OfferDestinationItem {
  conversationId: string;
  title: string | null;
  isGroup: boolean;
  sessionId: string | null;
  sessionName?: string | null;
}

// ── API wrapper ───────────────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}
