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

export type ChatWsPayload =
  | { event: 'chat.message.created'; data: WsMessageCreatedData }
  | { event: 'chat.conversation.updated'; data: WsConversationUpdatedData }
  | { event: 'chat.unread.updated'; data: WsUnreadUpdatedData }
  | { event: 'chat.session.updated'; data: WsSessionUpdatedData }
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
    let retryDelay = 2_000;
    let stopped = false;

    function connect(): void {
      if (stopped) return;

      const token    = localStorage.getItem('accessToken') ?? '';
      const tenantId = localStorage.getItem('activeTenantId') ?? '';
      const apiBase  = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

      // Convert /api prefix to a WebSocket URL.
      // In dev, Vite proxies /api → http://localhost:3000, so we derive ws:// from location.
      const httpBase = apiBase.startsWith('http')
        ? apiBase
        : `${window.location.protocol}//${window.location.host}${apiBase}`;
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

    connect();

    return () => {
      stopped = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      ws?.close();
    };
  }, []); // token is read on each (re)connect — no deps needed
}
