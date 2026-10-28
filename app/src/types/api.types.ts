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

export type OfferStatus = 'DRAFT' | 'SENDING' | 'PAUSED' | 'SENT' | 'FAILED' | 'CANCELLED';

export type OfferDispatchStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED' | 'CANCELLED';

/** Quem criou a oferta. */
export type OfferOrigin = 'GENERATOR' | 'MONITORING';

/** Um envio na fila de envio, com resumo da oferta e do grupo destino. */
export interface SendQueueItem {
  dispatchId: string;
  offerId: string;
  origin: OfferOrigin;
  offerStatus: OfferStatus;
  title: string | null;
  textPreview: string;
  imageUrl: string | null;
  coupon: string | null;
  conversationId: string;
  groupName: string | null;
  groupAvatarUrl: string | null;
  status: OfferDispatchStatus;
  /** Horário previsto (ISO, relógio do servidor). */
  notBefore: string;
  /** Início do envio (ISO); null antes de sair. */
  claimedAt: string | null;
  updatedAt: string;
  failureReason: string | null;
  /** Voltou para a fila porque a sessão estava fora do ar; sai quando ela reconectar. */
  waitingSession: boolean;
}

/** Fila de uma sessão: um envio por vez, na ordem de `notBefore`. */
export interface SendQueueSession {
  /** null = envios antigos sem sessão registrada. */
  sessionId: string | null;
  name: string | null;
  status: string | null;
  running: SendQueueItem | null;
  waiting: SendQueueItem[];
  /** Concluídos hoje, mais recentes primeiro (até 20). */
  recent: SendQueueItem[];
  counts: { waiting: number; paused: number; sentToday: number; failedToday: number; skippedToday: number };
}

export interface SendQueueResponse {
  serverTime: string;
  sessions: SendQueueSession[];
}

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
  /** Voltou para a fila porque a sessão estava fora do ar; sai quando ela reconectar. */
  waitingSession: boolean;
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
  /** Início agendado dos disparos (ISO); null = começa ao disparar. */
  scheduledAt: string | null;
  /** Gerador (painel) ou monitoramento de grupos. */
  origin: OfferOrigin;
  /** Validade (ISO): envio depois disso é pulado. null = sem validade. */
  expiresAt: string | null;
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
  /** Início agendado dos disparos (ISO). */
  scheduledAt?: string;
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
  /** null remove o agendamento. */
  scheduledAt?: string | null;
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
  avatarUrl: string | null;
  sessionId: string | null;
}

export type OfferDispatchOrder = 'SEQUENTIAL' | 'INTERLEAVED';

export interface OfferConfigSettings {
  /** Sessões que disparam, na ordem de envio. */
  sessionIds: string[];
  /** Pausa entre dois envios consecutivos (segundos), dentro e entre sessões. */
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  dispatchOrder: OfferDispatchOrder;
}

/** `config: null` = nunca configurado; `groupLimit: null` = sem limite de grupos no plano. */
export interface OfferConfigResponse {
  config: OfferConfigSettings | null;
  groups: OfferConfigGroup[];
  groupLimit: number | null;
  /** Entitlement `whatsapp_sessions`; null = sem limite do plano. */
  sessionLimit: number | null;
}

export interface SaveOfferConfigRequest {
  sessionIds: string[];
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  dispatchOrder: OfferDispatchOrder;
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

/** Grupo de que a sessão participa no WhatsApp. `conversationId` null = ainda sem conversa no chat. */
export interface SessionGroupItem {
  groupJid: string;
  title: string | null;
  avatarUrl: string | null;
  conversationId: string | null;
}

/** Grupo etiquetado com a sessão de origem (o painel junta a busca de várias sessões). */
export interface SessionGroupWithSession extends SessionGroupItem {
  sessionId: string;
}

export interface SessionGroupsResponse {
  groups: SessionGroupItem[];
  /** WhatsApp não respondeu: só os grupos que o chat já conhece. */
  partial: boolean;
}

// ─── Monitoramento de grupos (docs/monitoramento-grupos.md) ─────────────────────

/** Configuração do monitoramento de UMA sessão. Minutos do dia em `America/Sao_Paulo`. */
export interface GroupMonitorSettings {
  enabled: boolean;
  /** 0..1440. start=0 e end=1440 = sem restrição; end < start = janela que cruza a meia-noite. */
  windowStartMinute: number;
  windowEndMinute: number;
  /** Pausa entre envios (s), 60..3600, min ≤ max. */
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  /** Espera depois da captura antes do 1º envio (s), 0..7200. */
  startDelaySeconds: number;
  /** Validade da oferta sem cupom (min), 15..1440. */
  maxOfferAgeMinutes: number;
  /** Validade da oferta com cupom (min), 15..maxOfferAgeMinutes. */
  couponMaxAgeMinutes: number;
  mentionAll: boolean;
  simulateTyping: boolean;
  /** 1..30. */
  typingSeconds: number;
  /** Texto enviado: original do grupo (links trocados), modelo fixo com dados do produto, ou IA. */
  textMode: MonitorTextMode;
  /** Só com `AI`; `STANDARD` = modelo fixo. */
  audience: OfferAudience;
  /** Captura só com link vira oferta montada mesmo em `ORIGINAL`. */
  enrichLinkOnly: boolean;
}

export type MonitorTextMode = 'ORIGINAL' | 'TEMPLATE' | 'AI';

export interface MonitoredGroupItem {
  conversationId: string;
  groupJid: string;
  title: string | null;
  avatarUrl: string | null;
  /** Vazio = captura toda mensagem com link suportado. */
  keywords: string[];
}

export interface BroadcastGroupItem {
  conversationId: string;
  groupJid: string;
  title: string | null;
  avatarUrl: string | null;
  position: number;
}

export interface GroupMonitorConfigResponse {
  sessionId: string;
  settings: GroupMonitorSettings;
  monitoredGroups: MonitoredGroupItem[];
  broadcastGroups: BroadcastGroupItem[];
  /** Limites do plano (todas as sessões do tenant somadas). null = ilimitado. */
  limits: { monitoredGroups: number | null; broadcastGroups: number | null; mentionAllEnabled: boolean };
  /** Uso atual no tenant (todas as sessões). */
  usage: { monitoredGroups: number; broadcastGroups: number };
}

export type SaveGroupMonitorSettingsRequest = GroupMonitorSettings & { sessionId: string };

export interface SaveMonitoredGroupsRequest {
  sessionId: string;
  groups: { groupJid: string; keywords: string[] }[];
}

/** Ordem do array = ordem de envio. */
export interface SaveBroadcastGroupsRequest {
  sessionId: string;
  groupJids: string[];
}

export type CapturedOfferStatus = 'PENDING' | 'PROCESSING' | 'QUEUED' | 'SKIPPED' | 'FAILED';

/** Motivo de não ter ido para a fila (SKIPPED/FAILED). */
export type CapturedOfferReason =
  | 'NO_LINK'
  | 'UNSUPPORTED_MARKETPLACE'
  | 'CREDENTIAL_MISSING'
  | 'LINK_RESOLVE_FAILED'
  | 'EXPIRED'
  | 'MONITOR_DISABLED'
  | 'NO_BROADCAST_GROUPS'
  | 'KEYWORD_MISMATCH'
  | 'INTERNAL_ERROR';

export interface CapturedOfferItem {
  id: string;
  status: CapturedOfferStatus;
  reason: CapturedOfferReason | null;
  marketplace: AffiliateProvider | null;
  sourceGroupTitle: string | null;
  sourceGroupAvatarUrl: string | null;
  /** Texto final (com o link do tenant) ou o original, se não processou. Até 280 caracteres. */
  textPreview: string;
  imageUrl: string | null;
  coupon: string | null;
  /** Link do tenant que vai no envio. */
  affiliateUrl: string | null;
  /** Oferta criada na fila de envio (QUEUED). */
  offerId: string | null;
  /** De onde saiu o texto enviado; null até processar. */
  textSource: MonitorTextMode | null;
  /** `AI_*` quando a IA foi pedida e o texto caiu no modelo. */
  aiErrorCode: string | null;
  /** Estado da oferta na fila: pausar/retomar/parar agem nela, em todos os grupos de disparo. */
  offerStatus: OfferStatus | null;
  /** Envios concluídos × total da oferta (0/0 sem oferta). */
  sentCount: number;
  totalCount: number;
  capturedAt: string;
  expiresAt: string | null;
  /** 1º envio previsto (QUEUED). */
  startsAt: string | null;
  /** Foto da mensagem não pôde ser usada: a oferta sai só com texto. */
  imageUnavailable: boolean;
}

export interface CapturedOffersResponse {
  items: CapturedOfferItem[];
  /** Cursor opaco da próxima página; null = fim. */
  nextCursor: string | null;
}
