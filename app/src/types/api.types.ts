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
