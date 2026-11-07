/**
 * Canal painel ↔ extensão (chrome.runtime.sendMessage via externally_connectable,
 * ou pelo proxy de content script quando o navegador não o oferece — Orion).
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

// ── Transporte por proxy (navegador sem externally_connectable, ex.: Orion) ─
// Página ⇄ window.postMessage ⇄ content script na origem do painel ⇄
// chrome.runtime.sendMessage ⇄ service worker. O envelope é o MESMO do canal
// externo: o proxy só embrulha, nunca muda op/payload. Sem chrome.*, sem DOM.

export const PROXY_DIRECTION = 'proxy' as const;
/** Atributo em `<html>`: ids das extensões com proxy na página, separados por espaço. */
export const PROXY_MARKER_ATTR = 'data-cs-ext-proxy' as const;
/** Teto do pedido serializado pelo proxy (o canal só carrega payload pequeno). */
export const PROXY_MAX_BYTES = 64 * 1024;

type ProxyBase = { channel: typeof CHANNEL_NAME; direction: typeof PROXY_DIRECTION };

/** `from` = id da extensão que fala (content script → página); `to` = id endereçado (página → content script). */
export type ProxyMessage =
  | (ProxyBase & { kind: 'ready'; from: string })
  | (ProxyBase & { kind: 'req'; to: string; req: ChannelEnvelope })
  | (ProxyBase & { kind: 'res'; from: string; requestId: string; res: ChannelEnvelope })
  | (ProxyBase & { kind: 'fail'; from: string; requestId: string });

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;

const isEnvelopeOf = (v: unknown, direction: Direction): v is ChannelEnvelope => {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return e.channel === CHANNEL_NAME && e.direction === direction && isStr(e.requestId)
    && typeof e.version === 'number' && typeof e.timestamp === 'number' && typeof e.op === 'string';
};

/** Valida a forma de uma mensagem do proxy; qualquer coisa fora do contrato → `null`. */
export function parseProxyMessage(data: unknown): ProxyMessage | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m.channel !== CHANNEL_NAME || m.direction !== PROXY_DIRECTION) return null;
  switch (m.kind) {
    case 'ready':
      return isStr(m.from) ? (m as ProxyMessage) : null;
    case 'req':
      return isStr(m.to) && isEnvelopeOf(m.req, 'request') ? (m as ProxyMessage) : null;
    case 'res':
      return isStr(m.from) && isStr(m.requestId) && isEnvelopeOf(m.res, 'response')
        && (m.res as ChannelEnvelope).requestId === m.requestId ? (m as ProxyMessage) : null;
    case 'fail':
      return isStr(m.from) && isStr(m.requestId) ? (m as ProxyMessage) : null;
    default:
      return null;
  }
}

/** Ids anunciados no marcador de `<html>` (sem repetição). */
export function parseProxyMarker(attr: string | null | undefined): string[] {
  return [...new Set((attr ?? '').split(/\s+/).filter(isStr))];
}
