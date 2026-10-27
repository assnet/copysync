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
  /** Número informado na criação (`55DDDNÚMERO`), ou `null` em sessão antiga. */
  declaredPhone?: string | null;
  /** O WhatsApp conectado é de outro número que o informado. */
  phoneMismatch?: boolean;
}

export interface CreateSessionRequest {
  name: string;
  engine?: string;
  /** Número do WhatsApp esperado; a API valida (422 `SESSION_PHONE_INVALID`). */
  declaredPhone?: string;
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

export interface StartPairingResponse {
  pairingCode: string | null;
  status: SessionStatus;
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

/** Público-alvo do texto. `STANDARD` = modelo fixo (sem IA); os demais passam pela IA. */
export type OfferAudience = 'STANDARD' | 'MOMS' | 'PET' | 'BEAUTY_FASHION' | 'MEN' | 'FITNESS' | 'HOME_KITCHEN';

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
  /** O link colado pelo operador (normalizado): é o próprio link de afiliado. */
  affiliateUrl: string;
  /** `false` quando não deu para confirmar que o link é do operador (sem credencial ou Shopee). */
  attributionVerified: boolean;
  coupon: string | null;
  audience: OfferAudience;
  /** Menciona todos os participantes de cada grupo no envio. */
  mentionAll: boolean;
  /** Mostra "digitando…" por `typingSeconds` antes de cada envio. */
  simulateTyping: boolean;
  typingSeconds: number;
  text: string;
  /** Texto editado à mão: mudar título/preço não o remonta mais. */
  textEdited: boolean;
  status: OfferStatus;
  createdAt: string;
  updatedAt: string;
  dispatches?: OfferDispatchItem[];
}

export interface GenerateOfferRequest {
  url: string;
  coupon?: string;
  audience: OfferAudience;
}

export interface GenerateOfferResponse {
  offer: OfferItem;
  /** Marketplace sem dados automáticos: o operador preenche título, preço e foto. */
  needsManualData: boolean;
  /** A IA não respondeu; o texto veio do modelo padrão. */
  aiFallback: boolean;
  aiErrorCode?: string;
}

export interface RegenerateOfferResponse {
  offer: OfferItem;
  aiFallback: boolean;
  aiErrorCode?: string;
}

export interface UpdateOfferRequest {
  title?: string | null;
  priceCents?: number | null;
  originalPriceCents?: number | null;
  text?: string;
  imageUploadId?: string;
  coupon?: string | null;
  audience?: OfferAudience;
  mentionAll?: boolean;
  simulateTyping?: boolean;
  typingSeconds?: number;
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

/** Grupo de destino salvo na configuração do gerador. */
export interface OfferConfigGroup {
  conversationId: string;
  title: string | null;
  sessionId: string | null;
}

export interface OfferConfigSettings {
  sessionId: string | null;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
}

/** `config: null` = nunca configurado; `groupLimit: null` = sem limite de grupos no plano. */
export interface OfferConfigResponse {
  config: OfferConfigSettings | null;
  groups: OfferConfigGroup[];
  groupLimit: number | null;
}

export interface SaveOfferConfigRequest {
  sessionId: string;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  conversationIds: string[];
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

// ── IA (provedores da plataforma e chave do cliente) ──────────────────────────

export type AiProviderKind =
  | 'ANTHROPIC'
  | 'OPENAI'
  | 'GEMINI'
  | 'XAI'
  | 'DEEPSEEK'
  | 'GROQ'
  | 'MISTRAL'
  | 'OPENROUTER'
  | 'OPENAI_COMPATIBLE';

/** Item de `GET /ai/catalog` (e `/admin/ai/catalog`). */
export interface AiCatalogItem {
  kind: AiProviderKind;
  label: string;
  /** null = modelo obrigatório (endpoint próprio). */
  defaultModel: string | null;
  /** Pede o campo "URL da API" (só super admin). */
  requiresBaseUrl: boolean;
  /** Aparece no formulário de chave própria do cliente. */
  tenantAllowed: boolean;
}

export interface AiPlatformSettings {
  platformEnabled: boolean;
  tenantKeysEnabled: boolean;
}

export interface AiPlatformProvider {
  id: string;
  kind: AiProviderKind;
  label: string;
  model: string;
  enabled: boolean;
  priority: number;
  dailyLimitPerTenant: number | null;
  hasKey: boolean;
  /** Só em `OPENAI_COMPATIBLE`; null nos demais. */
  baseUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAiPlatformProviderRequest {
  kind: AiProviderKind;
  label: string;
  model: string;
  apiKey: string;
  enabled?: boolean;
  priority?: number;
  dailyLimitPerTenant?: number | null;
  /** Obrigatória em `OPENAI_COMPATIBLE`; ignorada nos demais. */
  baseUrl?: string | null;
}

/** `apiKey` vazio ou ausente mantém a chave atual. */
export type UpdateAiPlatformProviderRequest = Partial<CreateAiPlatformProviderRequest>;

export interface AiProviderTestResult {
  ok: boolean;
  errorCode?: string;
}

export type AiMode = 'PLATFORM' | 'TENANT' | 'NONE';

export interface TenantAiCredential {
  kind: AiProviderKind;
  model: string;
  enabled: boolean;
  /** Contrato do orquestrador; a spec fala em `masked` — os dois são aceitos. */
  hasKey?: boolean;
  masked?: string | null;
}

export interface TenantAiStatus {
  mode: AiMode;
  tenantKeysAllowed: boolean;
  platformAvailable: boolean;
  credential: TenantAiCredential | null;
}

export interface UpsertTenantAiCredentialRequest {
  kind: AiProviderKind;
  model: string;
  apiKey?: string;
}
