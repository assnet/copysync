import { useState, useCallback, useEffect } from 'react';
import { Box } from '@mui/material';
import type { ChatConversation, ChatMessage, ConversationFilter, QuotedMessagePreview } from '@/features/chat/types';
import { chatService } from '@/services/chat.service';
import {
  apiConversationToFrontend,
  apiMessageToFrontend,
} from '@/types/chat.api.types';
import type { UpdateConversationRequest } from '@/types/chat.api.types';
import { formatLastMessagePreview } from '@/features/chat/utils';
import { ConversationSidebar } from '@/features/chat/components/ConversationSidebar';
import { ChatWindow } from '@/features/chat/components/ChatWindow';
import { EmptyConversationState } from '@/features/chat/components/EmptyConversationState';
import { ConversationDetailsPanel } from '@/features/chat/components/ConversationDetailsPanel';
import { useChatWebSocket } from '@/hooks/useChatWebSocket';
import type { ChatWsPayload } from '@/hooks/useChatWebSocket';

// Altura da área de conteúdo: viewport - topbar (52px) - padding vertical (sm=48px, md=64px)
const CHAT_HEIGHT = {
  xs: 'calc(100vh - 88px)',
  sm: 'calc(100vh - 100px)',
  md: 'calc(100vh - 116px)',
};

const PAGE_SIZE = 40;

// Resolve quotedMessage para cada mensagem que tenha quotedMessageId
function resolveQuotedMessages(msgs: ChatMessage[]): ChatMessage[] {
  const byId = new Map(msgs.map((m) => [m.id, m]));
  return msgs.map((m) => {
    if (!m.quotedMessageId) return m;
    const q = byId.get(m.quotedMessageId);
    if (!q) return m;
    const quotedMessage: QuotedMessagePreview = {
      id:        q.id,
      type:      q.type,
      body:      q.body,
      mediaUrl:  q.mediaUrl,
      direction: q.direction,
      isDeleted: q.isDeleted,
    };
    return { ...m, quotedMessage };
  });
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [presenceMap, setPresenceMap] = useState<Record<string, string>>({});

  // Paginação reversa
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [oldestTimestamp, setOldestTimestamp] = useState<Record<string, string>>({});
  // Trigger para rolar ao fundo (incrementa a cada evento que exige scroll)
  const [scrollToBottom, setScrollToBottom] = useState(0);

  // Carrega todas as conversas uma vez ao montar.
  // Filtragem por status e pesquisa é feita localmente pelo ConversationSidebar.
  const loadConversations = useCallback(() => {
    setLoadingConversations(true);
    chatService
      .listConversations()
      .then((items) => setConversations(items.map(apiConversationToFrontend)))
      .catch((err: unknown) => console.error('Erro ao carregar conversas', err))
      .finally(() => setLoadingConversations(false));
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // ── Tempo real via WebSocket ───────────────────────────────────────────────
  useChatWebSocket(
    useCallback(
      (payload: ChatWsPayload) => {
        if (payload.event === 'ping') return;

        if (payload.event === 'chat.message.created') {
          const { conversationId, message, unreadCount, isNewConversation } = payload.data;

          if (isNewConversation) {
            // Nova conversa — recarrega completa para obter dados de contato/sessão
            loadConversations();
          } else {
            // Atualiza preview da conversa e move para o topo da lista
            const preview = formatLastMessagePreview(message.type, message.content);
            setConversations((prev) => {
              const updated = prev.map((c) =>
                c.id === conversationId
                  ? {
                      ...c,
                      lastMessage:   preview || c.lastMessage,
                      lastMessageAt: message.createdAt,
                      unreadCount,
                    }
                  : c,
              );
              // Move a conversa atualizada para o topo (como no legado1)
              const idx = updated.findIndex((c) => c.id === conversationId);
              if (idx > 0) {
                const [item] = updated.splice(idx, 1);
                updated.unshift(item);
              }
              return updated;
            });
          }

          // Adiciona a mensagem ao estado se a conversa estiver aberta
          setSelectedId((currentId) => {
            if (currentId === conversationId) {
              const frontendMsg = apiMessageToFrontend({
                ...message,
                tenantId:          payload.data.tenantId,
                direction:         message.direction as import('@/types/chat.api.types').ApiMessageDirection,
                type:              message.type as import('@/types/chat.api.types').ApiMessageType,
                status:            (message.status ?? 'SENT') as import('@/types/chat.api.types').ApiMessageStatus,
                externalMessageId: null,
              });
              setMessages((prev) => ({
                ...prev,
                [conversationId]: [...(prev[conversationId] ?? []), frontendMsg],
              }));
              // Dispara scroll ao fundo para nova mensagem recebida
              setScrollToBottom((v) => v + 1);
            }
            return currentId;
          });
        }

        if (payload.event === 'chat.conversation.updated') {
          const d = payload.data;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === d.conversationId
                ? {
                    ...c,
                    status:        d.status.toLowerCase() as import('@/features/chat/types').ConversationStatus,
                    queue:         d.queueName,
                    tags:          d.tags,
                    notes:         d.notes ?? '',
                    unreadCount:   d.unreadCount,
                    lastMessage:   d.lastMessagePreview ?? c.lastMessage,
                    lastMessageAt: d.lastMessageAt ?? c.lastMessageAt,
                  }
                : c,
            ),
          );
        }

        if (payload.event === 'chat.unread.updated') {
          const { conversationId, unreadCount } = payload.data;
          setConversations((prev) =>
            prev.map((c) => (c.id === conversationId ? { ...c, unreadCount } : c)),
          );
        }

        if (payload.event === 'chat.message.status.updated') {
          const { conversationId, messageId, status } = payload.data;
          setMessages((prev) => {
            const msgs = prev[conversationId];
            if (!msgs) return prev;
            return {
              ...prev,
              [conversationId]: msgs.map((m) =>
                m.id === messageId
                  ? { ...m, status: status.toLowerCase() as import('@/features/chat/types').MessageStatus }
                  : m,
              ),
            };
          });
        }

        if (payload.event === 'chat.presence.updated') {
          const { phone, presence } = payload.data;
          setPresenceMap((prev) => ({ ...prev, [phone]: presence }));
        }
      },
      [loadConversations],
    ),
  );

  const selectedConversation = selectedId
    ? conversations.find((c) => c.id === selectedId) ?? null
    : null;

  const selectedMessages = selectedId ? (messages[selectedId] ?? []) : [];

  const handleSelectConversation = useCallback(
    (id: string) => {
      setSelectedId(id);
      // Marca lida localmente de imediato
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)),
      );

      // Persiste no servidor e envia read receipts (double blue tick)
      chatService.markAsRead(id).catch((err: unknown) =>
        console.warn('Erro ao marcar conversa como lida', err),
      );

      // Subscribe to presence updates for this contact
      chatService.subscribePresence(id).catch(() => {});

      // Carrega mensagens se já estiver em cache — apenas dispara scroll
      if (messages[id]) {
        setScrollToBottom((v) => v + 1);
        return;
      }

      setLoadingMessages(true);
      chatService
        .listMessages(id, { limit: PAGE_SIZE })
        .then((items) => {
          const mapped = resolveQuotedMessages(items.map(apiMessageToFrontend));
          setMessages((prev) => ({ ...prev, [id]: mapped }));
          setHasMore((prev) => ({ ...prev, [id]: items.length >= PAGE_SIZE }));
          if (mapped.length > 0) {
            setOldestTimestamp((prev) => ({ ...prev, [id]: mapped[0].timestamp }));
          }
          setScrollToBottom((v) => v + 1);
        })
        .catch((err: unknown) => console.error('Erro ao carregar mensagens', err))
        .finally(() => setLoadingMessages(false));
    },
    [messages],
  );

  // ── Carregar mais (scroll para cima) ──────────────────────────────────────
  const handleLoadMore = useCallback(() => {
    if (!selectedId || isLoadingMore || !hasMore[selectedId]) return;
    const before = oldestTimestamp[selectedId];
    if (!before) return;

    setIsLoadingMore(true);
    chatService
      .listMessages(selectedId, { limit: PAGE_SIZE, before })
      .then((items) => {
        const mapped = items.map(apiMessageToFrontend);
        const merged = resolveQuotedMessages([...mapped, ...(messages[selectedId] ?? [])]);
        setMessages((prev) => ({
          ...prev,
          [selectedId]: merged,
        }));
        setHasMore((prev) => ({ ...prev, [selectedId]: items.length >= PAGE_SIZE }));
        if (mapped.length > 0) {
          setOldestTimestamp((prev) => ({ ...prev, [selectedId]: mapped[0].timestamp }));
        }
      })
      .catch((err: unknown) => console.error('Erro ao carregar mais mensagens', err))
      .finally(() => setIsLoadingMore(false));
  }, [selectedId, isLoadingMore, hasMore, oldestTimestamp]);

  const handleSendMessage = useCallback(
    (text: string, quotedMessageId?: string | null) => {
      if (!selectedId) return;

      // Preview da mensagem citada (para o update otimista)
      const quotedMessage: QuotedMessagePreview | undefined = quotedMessageId
        ? (() => {
            const q = (messages[selectedId] ?? []).find((m) => m.id === quotedMessageId);
            if (!q) return undefined;
            return { id: q.id, type: q.type, body: q.body, mediaUrl: q.mediaUrl, direction: q.direction, isDeleted: q.isDeleted };
          })()
        : undefined;

      // Otimistic: mostra a mensagem como "sending" imediatamente
      const tmpId = `tmp-${Date.now()}`;
      const optimistic: ChatMessage = {
        id: tmpId,
        conversationId: selectedId,
        type: 'text',
        direction: 'out',
        body: text,
        timestamp: new Date().toISOString(),
        status: 'sending',
        quotedMessageId: quotedMessageId ?? undefined,
        quotedMessage,
      };

      setMessages((prev) => ({
        ...prev,
        [selectedId]: [...(prev[selectedId] ?? []), optimistic],
      }));
      setScrollToBottom((v) => v + 1);

      chatService
        .sendMessage(selectedId, text, quotedMessageId ?? undefined)
        .then((sent) => {
          const realMsg = apiMessageToFrontend(sent);
          setMessages((prev) => ({
            ...prev,
            [selectedId]: (prev[selectedId] ?? []).map((m) =>
              m.id === tmpId ? realMsg : m,
            ),
          }));
          setConversations((prev) =>
            prev.map((c) =>
              c.id === selectedId
                ? { ...c, lastMessage: text, lastMessageAt: realMsg.timestamp }
                : c,
            ),
          );
        })
        .catch((err: unknown) => {
          console.error('Erro ao enviar mensagem', err);
          setMessages((prev) => ({
            ...prev,
            [selectedId]: (prev[selectedId] ?? []).map((m) =>
              m.id === tmpId ? { ...m, status: 'failed' as const } : m,
            ),
          }));
        });
    },
    [selectedId, messages],
  );

  const handleUpdateConversation = useCallback(
    (data: UpdateConversationRequest) => {
      if (!selectedId) return;
      chatService
        .updateConversation(selectedId, data)
        .then((updated) => {
          const conv = apiConversationToFrontend(updated);
          // Atualiza inline sem recarregar toda a lista
          setConversations((prev) =>
            prev.map((c) => (c.id === selectedId ? conv : c)),
          );
        })
        .catch((err: unknown) => console.error('Erro ao atualizar conversa', err));
    },
    [selectedId],
  );

  return (
    <Box
      sx={{
        display: 'flex',
        height: CHAT_HEIGHT,
        overflow: 'hidden',
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        mx: { xs: -2, sm: -3, md: -4 },
        mb: { xs: -2, sm: -3, md: -4 },
      }}
    >
      {/* Conversa sidebar — esquerda */}
      <ConversationSidebar
        conversations={conversations}
        selectedId={selectedId}
        onSelect={handleSelectConversation}
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={setFilter}
        loading={loadingConversations}
        presenceMap={presenceMap}
      />

      {/* Área central */}
      {selectedConversation ? (
        <ChatWindow
          conversation={selectedConversation}
          messages={selectedMessages}
          onSendMessage={handleSendMessage}
          detailsOpen={detailsOpen}
          onToggleDetails={() => setDetailsOpen((v) => !v)}
          loadingMessages={loadingMessages}
          presence={presenceMap[selectedConversation.contact.phone]}
          hasMore={selectedId ? (hasMore[selectedId] ?? false) : false}
          isLoadingMore={isLoadingMore}
          onLoadMore={handleLoadMore}
          scrollToBottom={scrollToBottom}
        />
      ) : (
        <EmptyConversationState />
      )}

      {/* Painel de contexto — direita */}
      {selectedConversation && detailsOpen && (
        <ConversationDetailsPanel
          conversation={selectedConversation}
          onClose={() => setDetailsOpen(false)}
          onUpdate={handleUpdateConversation}
        />
      )}
    </Box>
  );
}
