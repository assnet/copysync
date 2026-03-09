import { useState, useCallback, useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import type { ChatConversation, ChatMessage, ConversationFilter } from '@/features/chat/types';
import { chatService } from '@/services/chat.service';
import {
  apiConversationToFrontend,
  apiMessageToFrontend,
} from '@/types/chat.api.types';
import type { UpdateConversationRequest } from '@/types/chat.api.types';
import { ConversationSidebar } from '@/features/chat/components/ConversationSidebar';
import { ChatWindow } from '@/features/chat/components/ChatWindow';
import { EmptyConversationState } from '@/features/chat/components/EmptyConversationState';
import { ConversationDetailsPanel } from '@/features/chat/components/ConversationDetailsPanel';

// Altura da área de conteúdo: viewport - topbar (52px) - padding vertical (sm=48px, md=64px)
const CHAT_HEIGHT = {
  xs: 'calc(100vh - 88px)',
  sm: 'calc(100vh - 100px)',
  md: 'calc(100vh - 116px)',
};

export default function ChatPage() {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Debounce para pesquisa
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedSearch(search), 350);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [search]);

  // Carrega conversas sempre que filtro ou pesquisa mudar
  useEffect(() => {
    let cancelled = false;
    setLoadingConversations(true);

    const params: Record<string, unknown> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (filter === 'unread') params.unreadOnly = true;
    else if (filter !== 'all') params.status = filter.toUpperCase();

    chatService
      .listConversations(params as Parameters<typeof chatService.listConversations>[0])
      .then((items) => {
        if (!cancelled) {
          setConversations(items.map(apiConversationToFrontend));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) console.error('Erro ao carregar conversas', err);
      })
      .finally(() => { if (!cancelled) setLoadingConversations(false); });

    return () => { cancelled = true; };
  }, [debouncedSearch, filter]);

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

      // Carrega mensagens se ainda não tiver em cache
      if (messages[id]) return;

      setLoadingMessages(true);
      chatService
        .listMessages(id)
        .then((items) => {
          setMessages((prev) => ({ ...prev, [id]: items.map(apiMessageToFrontend) }));
        })
        .catch((err: unknown) => console.error('Erro ao carregar mensagens', err))
        .finally(() => setLoadingMessages(false));
    },
    [messages],
  );

  const handleSendMessage = useCallback(
    (text: string) => {
      if (!selectedId) return;

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
      };

      setMessages((prev) => ({
        ...prev,
        [selectedId]: [...(prev[selectedId] ?? []), optimistic],
      }));

      chatService
        .sendMessage(selectedId, text)
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
    [selectedId],
  );

  const handleUpdateConversation = useCallback(
    (data: UpdateConversationRequest) => {
      if (!selectedId) return;
      chatService
        .updateConversation(selectedId, data)
        .then((updated) => {
          const conv = apiConversationToFrontend(updated);
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
