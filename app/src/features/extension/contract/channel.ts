/**
 * Canal painel ↔ extensão (chrome.runtime.sendMessage via externally_connectable).
 * Copiado para `app/src/features/extension/contract/channel.ts` — parity enforced
 * by `scripts/check-contract-sync.mjs`.
 */

export const CHANNEL_NAME = 'cs-ext' as const;
export const CHANNEL_VERSION = 1 as const;

export type Direction = 'request' | 'response';

export interface ChannelEnvelope<P = unknown> {
  channel: typeof CHANNEL_NAME;
  version: number;
  direction: Direction;
  requestId: string;
  timestamp: number;
  op: string;
  payload: P;
}

export interface ChannelError {
  code: 'NEEDS_LOGIN' | 'AUTH' | 'FORBIDDEN' | 'INVALID_ENVELOPE' | 'UNKNOWN_OP' | 'RATE_LIMITED' | 'INTERNAL';
  reason?: 'MEMBERSHIP' | 'TENANT' | 'PLAN';
}

export type ChannelResponse<P = unknown> =
  | { ok: true; payload: P }
  | { ok: false; error: ChannelError };

// ── Ops v1 ──────────────────────────────────────────────────────────────────

export interface HandshakePayload {
  extVersion: string;
  contractVersion: number;
  caps: string[];
  authenticated: boolean;
  userId?: string;
  installationId?: string;
}

export interface BridgeIdentifyPayload {
  installationId: string;
  extensionId: string;
  version: string;
}

export interface SessionChangedPayload {}

export interface MlStatusPayload {
  loggedIn: boolean;
  lastSyncAt?: string;
  resyncRequested: boolean;
}

export interface MlSyncSessionPayload {
  result: 'UPDATED' | 'UNCHANGED' | 'FAILED';
  /** `SyncErrorCode` when `result === 'FAILED'` (e.g. `ml_not_logged`). Never carries secrets. */
  errorCode?: string;
}

export type OpMap = {
  'handshake': { request: Record<string, never>; response: HandshakePayload };
  'bridge.identify': { request: BridgeIdentifyPayload; response: Record<string, never> };
  'session.changed': { request: SessionChangedPayload; response: Record<string, never> };
  'ml.status': { request: Record<string, never>; response: MlStatusPayload };
  'ml.syncSession': { request: Record<string, never>; response: MlSyncSessionPayload };
};

export type OpName = keyof OpMap;
