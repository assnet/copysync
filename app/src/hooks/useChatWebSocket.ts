import { useEffect, useRef } from 'react';
import type { ChatMessageApiDto } from '@/types/chat.api.types';

// ── WS event types (mirror backend ChatWsEvent) ───────────────────────────────

export interface WsMessageCreatedData {
  tenantId: string;
  conversationId: string;
  message: ChatMessageApiDto & { mimeType: string | null };
  unreadCount: number;
  isNewConversation: boolean;
}

export interface WsConversationUpdatedData {
  tenantId: string;
  conversationId: string;
  status: string;
  assignedUserId: string | null;
  queueName: string | null;
  tags: string[];
  notes: string | null;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
}

export interface WsUnreadUpdatedData {
  tenantId: string;
  conversationId: string;
  unreadCount: number;
}

export interface WsSessionUpdatedData {
  tenantId: string;
  sessionId: string;
  status: string;
}

export interface WsMessageStatusUpdatedData {
  tenantId: string;
  conversationId: string;
  messageId: string;
  status: string;
}

export interface WsPresenceUpdatedData {
  tenantId: string;
  phone: string;
  presence: string;
}

export interface WsContactUpdatedData {
  tenantId: string;
  phone: string;
  avatarUrl: string;
}

export type ChatWsPayload =
  | { event: 'chat.message.created'; data: WsMessageCreatedData }
  | { event: 'chat.conversation.updated'; data: WsConversationUpdatedData }
  | { event: 'chat.unread.updated'; data: WsUnreadUpdatedData }
  | { event: 'chat.message.status.updated'; data: WsMessageStatusUpdatedData }
  | { event: 'chat.presence.updated'; data: WsPresenceUpdatedData }
  | { event: 'chat.session.updated'; data: WsSessionUpdatedData }
  | { event: 'chat.contact.updated'; data: WsContactUpdatedData }
  | { event: 'ping' };

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Connects to the Chat WebSocket gateway and delivers typed events to the caller.
 *
 * - Reconnects automatically with exponential backoff (2 s → 30 s)
 * - Disconnects cleanly on unmount
 * - Auth via ?token=... &tenantId=... (Authorization headers are not allowed in
 *   the browser WebSocket API)
 */
export function useChatWebSocket(onEvent: (payload: ChatWsPayload) => void): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let connectTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 2_000;
    let stopped = false;

    function connect(): void {
      if (stopped) return;

      const token    = localStorage.getItem('accessToken') ?? '';
      const tenantId = localStorage.getItem('activeTenantId') ?? '';

      // WebSocket upgrades cannot go through the Vite dev proxy (unreliable in
      // Vite 6 for sub-paths). We bypass it by connecting directly to the API
      // server using window.location.hostname (always the correct server IP,
      // even when accessed from other devices on the network) + VITE_API_PORT.
      const apiBase = (import.meta.env.VITE_API_URL as string | undefined)
        ?? 'http://localhost:3000/api';

      let httpBase: string;
      if (apiBase.startsWith('http')) {
        // Full URL — use it directly (e.g. http://192.168.1.x:3000/api)
        httpBase = apiBase;
      } else {
        // Relative path (e.g. /api) — build a direct URL to the API server,
        // skipping the Vite proxy which does not reliably forward WS upgrades.
        const apiPort = (import.meta.env.VITE_API_PORT as string | undefined) ?? '3000';
        httpBase = `http://${window.location.hostname}:${apiPort}${apiBase}`;
      }

      const wsBase = httpBase.replace(/^http/, 'ws');

      const url = `${wsBase}/chat/ws?token=${encodeURIComponent(token)}&tenantId=${encodeURIComponent(tenantId)}`;

      ws = new WebSocket(url);

      ws.onopen = () => {
        retryDelay = 2_000; // reset backoff on successful connect
      };

      ws.onmessage = (ev: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(ev.data) as ChatWsPayload;
          onEventRef.current(payload);
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        // onclose fires right after onerror — reconnect logic is there
      };

      ws.onclose = () => {
        ws = null;
        if (stopped) return;
        retryTimeout = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 30_000);
          connect();
        }, retryDelay);
      };
    }

    // Delay the initial connect by one tick so React StrictMode's synchronous
    // cleanup can cancel it before the WebSocket is even created, avoiding the
    // "WebSocket closed before the connection was established" console error.
    connectTimeout = setTimeout(connect, 0);

    return () => {
      stopped = true;
      if (connectTimeout) clearTimeout(connectTimeout);
      if (retryTimeout) clearTimeout(retryTimeout);
      ws?.close();
    };
  }, []); // token is read on each (re)connect — no deps needed
}
