import { useState, useCallback, useEffect } from 'react';
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
import { useChatSSE } from '@/hooks/useChatSSE';

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

  // ── Tempo real via SSE ─────────────────────────────────────────────────────
  useChatSSE(
    useCallback(
      (event: string, data: unknown) => {
        if (event === 'message_received') {
          // Recarrega a lista de conversas para refletir nova mensagem/conversa
          // (abordagem simples e segura — sem risco de dados desatualizados)
          loadConversations();

          // Se a conversa afetada estiver aberta, recarrega as mensagens também
          const payload = data as { from?: string };
          // Não sabemos ainda o conversationId a partir do from,
          // então recarregamos as mensagens da conversa selecionada
          setSelectedId((currentId) => {
            if (currentId) {
              chatService
                .listMessages(currentId)
                .then((items) => {
                  setMessages((prev) => ({ ...prev, [currentId]: items.map(apiMessageToFrontend) }));
                })
                .catch(() => {/* silencioso */});
            }
            return currentId;
          });

          void payload; // usado acima via type assertion
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
