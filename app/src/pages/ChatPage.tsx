import { useState, useCallback } from 'react';
import { Box } from '@mui/material';
import { v4 as uuidv4 } from 'uuid';
import type { ChatConversation, ChatMessage, ConversationFilter } from '@/features/chat/types';
import { MOCK_CONVERSATIONS, MOCK_MESSAGES } from '@/features/chat/mock/conversations.mock';
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
  const [conversations, setConversations] = useState<ChatConversation[]>(MOCK_CONVERSATIONS);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>(MOCK_MESSAGES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [detailsOpen, setDetailsOpen] = useState(true);

  const selectedConversation = selectedId
    ? conversations.find((c) => c.id === selectedId) ?? null
    : null;

  const selectedMessages = selectedId ? (messages[selectedId] ?? []) : [];

  const handleSelectConversation = useCallback((id: string) => {
    setSelectedId(id);
    // Marca como lida ao abrir
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
    );
  }, []);

  const handleSendMessage = useCallback(
    (text: string) => {
      if (!selectedId) return;

      const newMessage: ChatMessage = {
        id: uuidv4(),
        conversationId: selectedId,
        type: 'text',
        direction: 'out',
        body: text,
        timestamp: new Date().toISOString(),
        status: 'sending',
      };

      setMessages((prev) => ({
        ...prev,
        [selectedId]: [...(prev[selectedId] ?? []), newMessage],
      }));

      // Update last message on conversation
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId
            ? { ...c, lastMessage: text, lastMessageAt: newMessage.timestamp }
            : c
        )
      );

      // Simulate delivery after 600ms
      setTimeout(() => {
        setMessages((prev) => ({
          ...prev,
          [selectedId]: (prev[selectedId] ?? []).map((m) =>
            m.id === newMessage.id ? { ...m, status: 'delivered' } : m
          ),
        }));
      }, 600);
    },
    [selectedId]
  );

  return (
    <Box
      sx={{
        display: 'flex',
        height: CHAT_HEIGHT,
        overflow: 'hidden',
        borderRadius: 3,
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
      />

      {/* Área central */}
      {selectedConversation ? (
        <ChatWindow
          conversation={selectedConversation}
          messages={selectedMessages}
          onSendMessage={handleSendMessage}
          detailsOpen={detailsOpen}
          onToggleDetails={() => setDetailsOpen((v) => !v)}
        />
      ) : (
        <EmptyConversationState />
      )}

      {/* Painel de contexto — direita */}
      {selectedConversation && detailsOpen && (
        <ConversationDetailsPanel
          conversation={selectedConversation}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </Box>
  );
}
