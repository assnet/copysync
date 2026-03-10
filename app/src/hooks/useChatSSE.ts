import { useEffect, useRef } from 'react';

/**
 * Conecta ao endpoint SSE da API e chama `onEvent` para cada evento recebido.
 *
 * - Reconecta automaticamente em caso de falha (backoff simples)
 * - Fecha a conexão quando o componente desmonta
 * - Injeta token e tenantId via query string (EventSource não suporta headers)
 */
export function useChatSSE(onEvent: (event: string, data: unknown) => void): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 2_000;
    let stopped = false;

    function connect() {
      if (stopped) return;

      const token = localStorage.getItem('accessToken') ?? '';
      const tenantId = localStorage.getItem('activeTenantId') ?? '';
      const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
      const url = `${base}/chat/events?token=${encodeURIComponent(token)}&tenantId=${encodeURIComponent(tenantId)}`;

      es = new EventSource(url);

      es.onopen = () => {
        retryDelay = 2_000; // reset backoff on successful connect
      };

      es.addEventListener('message_received', (e: MessageEvent) => {
        try {
          onEventRef.current('message_received', JSON.parse(e.data as string));
        } catch { /* ignore malformed */ }
      });

      es.onerror = () => {
        es?.close();
        es = null;
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
      es?.close();
    };
  }, []); // sem dependências — o token é lido na hora de conectar/reconectar
}
