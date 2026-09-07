import { useState, useCallback, useEffect, useMemo } from 'react';
import { Box } from '@mui/material';
import type { ChatConversation, ChatMessage, ConversationFilter, QuotedMessagePreview } from '@/features/chat/types';
import { chatService } from '@/services/chat.service';
import { sessionService } from '@/services/session.service';
import {
  apiConversationToFrontend,
  apiMessageToFrontend,
} from '@/types/chat.api.types';
import type { UpdateConversationRequest } from '@/types/chat.api.types';
import { formatLastMessagePreview } from '@/features/chat/utils';
import { resolveMediaUrl } from '@/utils/resolveMediaUrl';
import { ConversationSidebar } from '@/features/chat/components/ConversationSidebar';
import { ChatWindow } from '@/features/chat/components/ChatWindow';
import { EmptyConversationState } from '@/features/chat/components/EmptyConversationState';
import { ConversationDetailsPanel } from '@/features/chat/components/ConversationDetailsPanel';
import { useChatWebSocket } from '@/hooks/useChatWebSocket';
import type { ChatWsPayload } from '@/hooks/useChatWebSocket';
import type { SessionItem, SessionStatus } from '@/types/api.types';
import type { GroupParticipantApiDto } from '@/types/chat.api.types';

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
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [presenceMap, setPresenceMap] = useState<Record<string, string>>({});
  // Participantes do grupo aberto: alimentam o painel de contexto e servem de fonte
  // de avatar para as bolhas, já que participante de grupo raramente tem contato
  // salvo no tenant (só 7 de 1503 contatos têm avatar).
  const [participants, setParticipants] = useState<GroupParticipantApiDto[]>([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);

  // Paginação reversa
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [oldestTimestamp, setOldestTimestamp] = useState<Record<string, string>>({});
  // Sinal para rolar ao fundo. `smooth` distingue a intenção: abrir uma conversa
  // deve posicionar no fim instantaneamente, enquanto uma mensagem nova numa conversa
  // já aberta rola suavemente. Inferir isso de um contador global fazia toda abertura
  // a partir da segunda animar a rolagem da mensagem mais antiga até a mais recente.
  const [scrollSignal, setScrollSignal] = useState({ n: 0, smooth: false });
  const requestScroll = useCallback((smooth: boolean) => {
    setScrollSignal((prev) => ({ n: prev.n + 1, smooth }));
  }, []);

  const loadSessions = useCallback(() => {
    sessionService
      .list()
      .then((data) => setSessions(data.sessions ?? []))
      .catch((err: unknown) => console.error('Erro ao carregar sessões do chat', err));
  }, []);

  // Carrega as conversas respeitando o filtro de sessão.
  // Filtragem por status e pesquisa continua local no ConversationSidebar.
  const loadConversations = useCallback(() => {
    setLoadingConversations(true);
    chatService
      .listConversations(selectedSessionId ? { sessionId: selectedSessionId } : undefined)
      .then((items) => {
        const nextConversations = items.map(apiConversationToFrontend);
        setConversations(nextConversations);
        setSelectedId((current) => (
          current && nextConversations.some((conversation) => conversation.id === current)
            ? current
            : null
        ));
      })
      .catch((err: unknown) => console.error('Erro ao carregar conversas', err))
      .finally(() => setLoadingConversations(false));
  }, [selectedSessionId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Participantes da conversa aberta (só grupos)
  useEffect(() => {
    const conv = conversations.find((c) => c.id === selectedId);
    if (!selectedId || !conv?.isGroup) {
      setParticipants([]);
      return;
    }
    let cancelled = false;
    setLoadingParticipants(true);
    chatService
      .listGroupParticipants(selectedId)
      .then((items) => { if (!cancelled) setParticipants(items); })
      .catch(() => { if (!cancelled) setParticipants([]); })
      .finally(() => { if (!cancelled) setLoadingParticipants(false); });
    return () => { cancelled = true; };
  }, [selectedId, conversations]);

  // Mapa telefone → avatar, usado como fallback nas bolhas de grupo
  const participantAvatars = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of participants) {
      if (p.phone && p.avatarUrl) map[p.phone] = p.avatarUrl;
    }
    return map;
  }, [participants]);

  // Preenche os avatares que faltam. Cada foto é uma consulta ao WhatsApp, então a
  // API trabalha em lotes e devolve quantas sobraram; repetimos até zerar. As fotos
  // obtidas chegam pelos eventos chat.contact.updated / chat.group.avatar.updated.
  useEffect(() => {
    let cancelled = false;
    let rounds = 0;

    const run = async () => {
      while (!cancelled && rounds < 10) {
        rounds += 1;
        try {
          const { updated, remaining } = await chatService.syncAvatars();
          if (remaining === 0 || updated === 0) return;
        } catch {
          return; // sessão desconectada ou erro de rede — tenta de novo no próximo load
        }
      }
    };

    void run();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (selectedSessionId && !sessions.some((session) => session.id === selectedSessionId && session.status === 'CONNECTED')) {
      setSelectedSessionId(null);
    }
  }, [sessions, selectedSessionId]);

  const connectedSessions = sessions.filter((session) => session.status === 'CONNECTED');

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

          const frontendMsg = apiMessageToFrontend({
            ...message,
            tenantId:          payload.data.tenantId,
            direction:         message.direction as import('@/types/chat.api.types').ApiMessageDirection,
            type:              message.type as import('@/types/chat.api.types').ApiMessageType,
            status:            (message.status ?? 'SENT') as import('@/types/chat.api.types').ApiMessageStatus,
            externalMessageId: null,
          });

          // Anexa ao cache da conversa mesmo com ela fechada: ao reabrir, o cache é
          // reaproveitado sem refetch, então uma mensagem ignorada aqui só reapareceria
          // após recarregar a página.
          setMessages((prev) => {
            const cur = prev[conversationId];
            // Conversa ainda não carregada: não criar um cache parcial, senão a
            // abertura reaproveitaria essa lista de um item só e pularia o fetch.
            if (!cur) return prev;
            // A mesma mensagem pode chegar mais de uma vez: duas conexões WS
            // (StrictMode monta o efeito duas vezes em dev), uma reconexão que
            // reentrega o evento, ou corrida entre o evento e um refetch.
            // Sem esta checagem o React acusa chaves duplicadas e a bolha aparece
            // repetida na conversa.
            if (cur.some((m) => m.id === frontendMsg.id)) return prev;
            return {
              ...prev,
              [conversationId]: resolveQuotedMessages([...cur, frontendMsg]),
            };
          });

          // Scroll ao fundo apenas quando a conversa está aberta na tela
          setSelectedId((currentId) => {
            if (currentId === conversationId) {
              requestScroll(true);
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

        if (payload.event === 'chat.contact.updated') {
          const { phone } = payload.data;
          // O backend publica caminho relativo (/api/storage/...); o painel é servido
          // por outro domínio em produção, então precisa resolver contra a API.
          const avatarUrl = resolveMediaUrl(payload.data.avatarUrl);
          setConversations((prev) =>
            prev.map((c) =>
              c.contact.phone === phone
                ? { ...c, contact: { ...c.contact, avatarUrl } }
                : c,
            ),
          );
        }

        if (payload.event === 'chat.group.avatar.updated') {
          const { groupJid } = payload.data;
          const avatarUrl = resolveMediaUrl(payload.data.avatarUrl);
          setConversations((prev) =>
            prev.map((c) =>
              c.groupJid === groupJid
                ? { ...c, contact: { ...c.contact, avatarUrl } }
                : c,
            ),
          );
        }

        if (payload.event === 'chat.session.updated') {
          const nextStatus = payload.data.status as SessionStatus;
          setSessions((prev) =>
            prev.map((session) => (
              session.id === payload.data.sessionId
                ? { ...session, status: nextStatus }
                : session
            )),
          );
          loadSessions();
        }
      },
      [loadConversations, loadSessions],
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
        requestScroll(false);
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
          requestScroll(false);
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
      requestScroll(true);

      chatService
        .sendMessage(selectedId, text, quotedMessageId ?? undefined)
        .then((sent) => {
          const realMsg = apiMessageToFrontend(sent);
          setMessages((prev) => {
            const updated = (prev[selectedId] ?? []).map((m) =>
              m.id === tmpId ? realMsg : m,
            );
            return { ...prev, [selectedId]: resolveQuotedMessages(updated) };
          });
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

  // Abre a conversa direta com um participante de grupo pelo telefone
  const handleParticipantClick = useCallback(
    (phone: string, _name: string) => {
      const conv = conversations.find((c) => c.contact.phone === phone && !c.isGroup);
      if (conv) {
        handleSelectConversation(conv.id);
      }
      // Se não tiver conversa direta com este contato, não faz nada por enquanto
    },
    [conversations, handleSelectConversation],
  );

  return (
    <Box
      sx={{
        display: 'flex',
        position: 'relative',
        height: CHAT_HEIGHT,
        overflow: 'hidden',
        borderRadius: 0, 
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        mx: { xs: -2, sm: -3, md: -4 },
        mb: { xs: -2, sm: -3, md: -4 },
      }}
    >
      {/* Lista de conversas. No mobile é uma tela inteira e some quando há conversa
          aberta — navegação por telas, como num app de mensagens. */}
      <Box
        sx={{
          display: {
            xs: selectedConversation ? 'none' : 'flex',
            sm: 'flex',
          },
          flexDirection: 'column',
          minWidth: 0,
          width: { xs: '100%', sm: 'auto' },
        }}
      >
      <ConversationSidebar
        conversations={conversations}
        selectedId={selectedId}
        onSelect={handleSelectConversation}
        sessions={connectedSessions.map((session) => ({
          id: session.id,
          name: session.name,
          phone: session.phone,
        }))}
        selectedSessionId={selectedSessionId}
        onSessionChange={setSelectedSessionId}
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={setFilter}
        loading={loadingConversations}
        presenceMap={presenceMap}
      />
      </Box>

      {/* Área central — no mobile ocupa a tela quando há conversa selecionada */}
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
          scrollSignal={scrollSignal}
          onParticipantClick={handleParticipantClick}
          participantAvatars={participantAvatars}
          onBack={() => setSelectedId(null)}
        />
      ) : (
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, flex: 1, minWidth: 0 }}>
          <EmptyConversationState />
        </Box>
      )}

      {/* Painel de contexto. No desktop é a terceira coluna; no mobile ocupa a tela,
          já que não há largura para três colunas. */}
      {selectedConversation && detailsOpen && (
        <Box
          sx={{
            display: 'flex',
            position: { xs: 'absolute', sm: 'static' },
            inset: { xs: 0, sm: 'auto' },
            zIndex: { xs: 3, sm: 'auto' },
            bgcolor: 'background.paper',
          }}
        >
        <ConversationDetailsPanel
          conversation={selectedConversation}
          onClose={() => setDetailsOpen(false)}
          onUpdate={handleUpdateConversation}
          participants={participants}
          loadingParticipants={loadingParticipants}
        />
        </Box>
      )}
    </Box>
  );
}
