import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { MentionNamesContext } from '../features/chat/mentions';
import { Alert, Box, Snackbar, useMediaQuery, useTheme } from '@mui/material';
import type {
  ChatConversation,
  ChatMessage,
  ConversationFilter,
  MessageStatus,
  QuotedMessagePreview,
} from '@/features/chat/types';
import { chatService } from '@/services/chat.service';
import { sessionService } from '@/services/session.service';
import {
  apiConversationToFrontend,
  apiMessageToFrontend,
  apiReactionToFrontend,
} from '@/types/chat.api.types';
import type { ChatMessageApiDto, UpdateConversationRequest } from '@/types/chat.api.types';
import { formatLastMessagePreview, byPinnedThenRecent } from '@/features/chat/utils';
import { resolveMediaUrl } from '@/utils/resolveMediaUrl';
import { ConversationSidebar } from '@/features/chat/components/ConversationSidebar';
import { ChatWindow } from '@/features/chat/components/ChatWindow';
import { EmptyConversationState } from '@/features/chat/components/EmptyConversationState';
import { ConversationDetailsPanel } from '@/features/chat/components/ConversationDetailsPanel';
import { ConversationSearchPanel } from '@/features/chat/components/ConversationSearchPanel';
import { NewConversationDialog } from '@/features/chat/components/NewConversationDialog';
import { ConversationActionsMenu } from '@/features/chat/components/ConversationActionsMenu';
import type { ConversationStateChange } from '@/features/chat/components/ConversationActionsMenu';
import { useChatWebSocket } from '@/hooks/useChatWebSocket';
import type { ChatWsPayload } from '@/hooks/useChatWebSocket';
import type { SessionItem, SessionStatus } from '@/types/api.types';
import type { GroupParticipantApiDto, ReactionSummaryApiDto } from '@/types/chat.api.types';
import {
  acceptIntoMessages,
  keepNewerReactions,
  overlayPending,
  reducePending,
  type PendingAction,
  type PendingReaction,
} from '@/features/chat/reactionsState';
import type { ReactionDispatchEvent } from '@/features/chat/reactionDispatcher';
import { useReactionDispatcher } from '@/features/chat/useReactionDispatcher';
import { chatStrings } from '@/features/chat/strings';
import {
  applyListRemoval, applyListRename, collectKnownLists, listFilter, listFilterName, planListMembers,
  type ListUpdatePlan,
} from '@/features/chat/conversationFilters';
import { isAxiosError } from 'axios';
import type { ChatListDto } from '@/types/chat.api.types';
import { useOutgoingMedia, useOutgoingMediaItems } from '@/features/chat/media/OutgoingMediaProvider';
import { overlayOutgoing } from '@/features/chat/media/outgoingMediaState';
import { useMediaUploadConfig } from '@/features/chat/media/useMediaUploadConfig';
import { useVoiceRecorderBinding, type VoiceNoticeSeverity } from '@/features/chat/media/VoiceRecorderProvider';
import { mergeLatestMessages, upsertConfirmedMessage } from '@/features/chat/messagesMerge';
import type { AttachmentSendItem } from '@/features/chat/components/AttachmentPreviewPanel';

// Altura da área de conteúdo: viewport - topbar (52px) - padding vertical (sm=48px, md=64px)
// Altura útil = viewport menos a barra superior (AppBar de 56px no mobile, topbar de
// 52px no desktop). O padding do wrapper é anulado pela margem negativa do container.
const CHAT_HEIGHT = {
  xs: 'calc(100vh - 56px)',
  sm: 'calc(100vh - 52px)',
};

const PAGE_SIZE = 40;

const toAggregate = (revision: string | null, reactions: ReactionSummaryApiDto[]) => ({
  revision,
  reactions: reactions.map(apiReactionToFrontend),
});

// Resolve quotedMessage para cada mensagem que tenha quotedMessageId
function resolveQuotedMessages(msgs: ChatMessage[]): ChatMessage[] {
  const byId = new Map(msgs.map((m) => [m.id, m]));
  return msgs.map((m) => {
    if (!m.quotedMessageId) return m;
    const q = byId.get(m.quotedMessageId);
    if (!q) return m;
    // Mesma prévia → mesmo objeto: a bolha memoizada não re-renderiza a cada render da página.
    const cur = m.quotedMessage;
    if (
      cur && cur.id === q.id && cur.type === q.type && cur.body === q.body &&
      cur.mediaUrl === q.mediaUrl && cur.direction === q.direction && cur.isDeleted === q.isDeleted
    ) {
      return m;
    }
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
  // Catálogo de listas do tenant: existe independente das conversas carregadas (lista vazia
  // conta) e traz a contagem de todas as conversas, não só as do painel.
  const [lists, setLists] = useState<ChatListDto[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  // O handler do WebSocket é memoizado: a ref diz se um id já está na lista da página.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // O handler do WebSocket é memoizado e não enxerga o selectedId corrente; a ref evita
  // recriar a assinatura a cada troca de conversa.
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const markAsReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  // No mobile o painel de contexto é uma sobreposição de tela cheia: começar aberto
  // esconderia a conversa que o usuário acabou de abrir.
  const isMobile = useMediaQuery(useTheme().breakpoints.down('sm'));
  const [detailsOpen, setDetailsOpen] = useState(!isMobile);

  useEffect(() => {
    if (isMobile) setDetailsOpen(false);
  }, [isMobile]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [presenceMap, setPresenceMap] = useState<Record<string, string>>({});
  // Arquivadas ficam numa visão à parte, como no WhatsApp Web.
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [archivedCount, setArchivedCount] = useState(0);
  // Gestos de reação sem resposta, por mensagem. O agregado do servidor fica na própria mensagem.
  const [pendingReactions, setPendingReactions] = useState<Record<string, PendingReaction[]>>({});
  // Aviso no Snackbar da página: falha de ação (reação, reenvio de mídia) e avisos da voz.
  const [toast, setToast] = useState<{ message: string; severity: VoiceNoticeSeverity } | null>(null);
  const setErrorToast = useCallback((message: string) => setToast({ message, severity: 'error' }), []);
  const showNotice = useCallback(
    (message: string, severity: VoiceNoticeSeverity) => setToast({ message, severity }),
    [],
  );
  // Participantes do grupo aberto: alimentam o painel de contexto e servem de fonte
  // de avatar para as bolhas, já que participante de grupo raramente tem contato
  // salvo no tenant (só 7 de 1503 contatos têm avatar).
  const [participants, setParticipants] = useState<GroupParticipantApiDto[]>([]);
  const [participantsTotal, setParticipantsTotal] = useState(0);
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

  // ── Envio de mídia (bolhas vivem no `OutgoingMediaProvider` do layout, sobrepostas aqui) ──
  const mediaUpload = useMediaUploadConfig();
  // Confirmações que chegaram com a conversa sem cache (GET de abertura em voo): entram na mescla
  // do GET. Criar um cache parcial aqui faria a abertura pular o fetch.
  const confirmedBeforeLoadRef = useRef<Record<string, ChatMessage[]>>({});

  /** Mensagem real do 202/200. Pode já estar na lista (refetch): troca em vez de anexar. */
  const handleMediaConfirmed = useCallback((conversationId: string, message: ChatMessage) => {
    if (!messagesRef.current[conversationId]) {
      const stash = confirmedBeforeLoadRef.current;
      stash[conversationId] = upsertConfirmedMessage(stash[conversationId] ?? [], message);
    }
    setMessages((prev) => {
      const cur = prev[conversationId];
      if (!cur) return prev;
      return { ...prev, [conversationId]: upsertConfirmedMessage(cur, message) };
    });
    const preview = formatLastMessagePreview(message.type, message.body);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? { ...c, lastMessage: preview || c.lastMessage, lastMessageAt: message.timestamp }
          : c,
      ),
    );
  }, []);

  const {
    enqueue: enqueueMedia,
    cancel: cancelMediaUpload,
    retry: retryMediaUpload,
    discard: discardMediaUpload,
    retryServerMessage,
    onWsStatus: onMediaWsStatus,
  } = useOutgoingMedia(handleMediaConfirmed);
  // Só as bolhas da conversa aberta: progresso de outra conversa não re-renderiza a página.
  const outgoingItems = useOutgoingMediaItems(selectedId);

  /**
   * Página mais recente do GET (abertura ou resync) mesclada à lista local: mídia confirmada e
   * texto enviado com o GET em voo não somem. A paginação recomeça da página nova.
   */
  const applyLatestPage = useCallback((conversationId: string, items: ChatMessageApiDto[]) => {
    const fetched = items.map(apiMessageToFrontend);
    const stashed = confirmedBeforeLoadRef.current[conversationId] ?? [];
    delete confirmedBeforeLoadRef.current[conversationId];
    setMessages((prev) => {
      const local = stashed.reduce((list, m) => upsertConfirmedMessage(list, m), prev[conversationId] ?? []);
      const merged = resolveQuotedMessages(mergeLatestMessages(local, fetched));
      return { ...prev, [conversationId]: keepNewerReactions(prev[conversationId], merged) };
    });
    setHasMore((prev) => ({ ...prev, [conversationId]: items.length >= PAGE_SIZE }));
    if (fetched.length > 0) {
      setOldestTimestamp((prev) => ({ ...prev, [conversationId]: fetched[0].timestamp }));
    }
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
    return chatService
      .listConversations({
        ...(selectedSessionId ? { sessionId: selectedSessionId } : {}),
        ...(showArchived ? { archived: 'true' } : {}),
      })
      .then(({ conversations: items, archivedCount: count }) => {
        const nextConversations = items.map(apiConversationToFrontend);
        setConversations(nextConversations);
        setArchivedCount(count);
        setSelectedId((current) => (
          current && nextConversations.some((conversation) => conversation.id === current)
            ? current
            : null
        ));
      })
      .catch((err: unknown) => console.error('Erro ao carregar conversas', err))
      .finally(() => setLoadingConversations(false));
  }, [selectedSessionId, showArchived]);

  // Recarregada junto com as conversas e depois de criar/renomear/excluir ou de mudar
  // `lists` de uma conversa — qualquer um desses muda nomes ou contagens do catálogo.
  const loadLists = useCallback(() => {
    return chatService
      .listLists()
      .then(setLists)
      .catch((err: unknown) => {
        console.error('Erro ao carregar as listas', err);
        setErrorToast(chatStrings.lists.errors.loadFailed);
      });
  }, [setErrorToast]);

  useEffect(() => {
    loadConversations();
    void loadLists();
  }, [loadConversations, loadLists]);

  // Esc fecha em cascata: primeiro o painel de contexto ou a busca, depois a conversa.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Diálogos e menus tratam o próprio Esc; não interferir enquanto houver um aberto.
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;

      if (searchPanelOpen) { setSearchPanelOpen(false); return; }
      if (detailsOpen && selectedId) { setDetailsOpen(false); return; }
      if (selectedId) setSelectedId(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchPanelOpen, detailsOpen, selectedId]);

  // Participantes da conversa aberta (só grupos)
  useEffect(() => {
    const conv = conversations.find((c) => c.id === selectedId);
    if (!selectedId || !conv?.isGroup) {
      setParticipants([]);
      return;
    }
    let cancelled = false;
    setLoadingParticipants(true);
    // Só a prévia: a lista completa fica no modal, carregada sob demanda.
    chatService
      .listGroupParticipants(selectedId)
      .then(({ participants: items, total }) => {
        if (cancelled) return;
        setParticipants(items);
        setParticipantsTotal(total);
      })
      .catch(() => { if (!cancelled) { setParticipants([]); setParticipantsTotal(0); } })
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

  // Mapa telefone → nome, para exibir `@Nome` nas menções (o texto gravado traz o telefone)
  const participantNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of participants) {
      if (p.phone && p.name && !/^[\d\s+()-]+$/.test(p.name)) map[p.phone] = p.name;
    }
    return map;
  }, [participants]);

  // Nomes acumulados: contatos das conversas individuais já carregadas e participantes de
  // todo grupo aberto na sessão. A prévia da lista (atualizada em tempo real com `@<telefone>`)
  // e o balão mostram `@Nome` sem nova ida à API — e seguem funcionando quando a lista de
  // participantes não chega (sessão desconectada no momento).
  const [knownMentionNames, setKnownMentionNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const entries: [string, string][] = [];
    for (const conv of conversations) {
      const { phone, name } = conv.contact;
      if (!conv.isGroup && phone && name && !/^[\d\s+()-]+$/.test(name)) entries.push([phone, name]);
    }
    entries.push(...Object.entries(participantNames));
    if (entries.length === 0) return;
    setKnownMentionNames((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [phone, name] of entries) {
        if (next[phone] !== name) { next[phone] = name; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [conversations, participantNames]);

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

  const connectedSessions = useMemo(
    () => sessions.filter((session) => session.status === 'CONNECTED'),
    [sessions],
  );
  // Referência estável: o diálogo reage a mudanças nesta lista.
  const sessionOptions = useMemo(
    () => connectedSessions.map((s) => ({ id: s.id, name: s.name, phone: s.phone })),
    [connectedSessions],
  );

  /**
   * Confirma a leitura no servidor uma vez por janela, não por mensagem.
   *
   * Sem isso, cinco mensagens em rajada na conversa aberta virariam cinco chamadas de
   * saída ao WhatsApp — volume que não corresponde a comportamento humano.
   */
  const scheduleMarkAsRead = useCallback((conversationId: string) => {
    if (markAsReadTimer.current) clearTimeout(markAsReadTimer.current);
    markAsReadTimer.current = setTimeout(() => {
      markAsReadTimer.current = null;
      if (selectedIdRef.current !== conversationId) return; // trocou de conversa no meio
      chatService.markAsRead(conversationId).catch((err: unknown) =>
        console.warn('Erro ao marcar conversa como lida', err),
      );
    }, 1_500);
  }, []);

  // Nenhum recibo pendente sobrevive à saída da tela.
  useEffect(() => () => {
    if (markAsReadTimer.current) clearTimeout(markAsReadTimer.current);
  }, []);

  /**
   * Volta do WS (queda, aba dormindo): os frames perdidos não são reenviados. Recarrega a lista,
   * a conversa aberta (mídia que ficou `sending` sem o `status.updated`) com a mesma mescla da
   * abertura, e descarta o cache das outras — perderam os mesmos frames; reabrir busca de novo.
   */
  const handleResync = useCallback(() => {
    void loadConversations();
    const openId = selectedIdRef.current;
    setMessages((prev) => (openId && prev[openId] ? { [openId]: prev[openId] } : {}));
    if (!openId) return;
    chatService
      .listMessages(openId, { limit: PAGE_SIZE })
      .then((items) => applyLatestPage(openId, items))
      .catch((err: unknown) => console.error('Erro ao recarregar mensagens', err));
  }, [loadConversations, applyLatestPage]);

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
            // Mensagem que chega na conversa aberta já está sendo lida: marcar não lida
            // aqui obrigaria o operador a "limpar" um badge do que ele acabou de ver.
            const estaAberta = selectedIdRef.current === conversationId;
            setConversations((prev) => {
              const updated = prev.map((c) =>
                c.id === conversationId
                  ? {
                      ...c,
                      lastMessage:   preview || c.lastMessage,
                      lastMessageAt: message.createdAt,
                      ...(estaAberta ? {} : { unreadCount }),
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

            // Agrupa as confirmações de leitura: uma rajada de mensagens não pode virar
            // uma chamada de saída por mensagem.
            if (estaAberta) scheduleMarkAsRead(conversationId);
          }

          const frontendMsg = apiMessageToFrontend({
            ...message,
            tenantId:          payload.data.tenantId,
            direction:         message.direction as import('@/types/chat.api.types').ApiMessageDirection,
            type:              message.type as import('@/types/chat.api.types').ApiMessageType,
            status:            (message.status ?? 'SENT') as import('@/types/chat.api.types').ApiMessageStatus,
            externalMessageId: message.externalMessageId ?? null,
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
          const { conversationId, unreadCount, manuallyUnread } = payload.data;
          setConversations((prev) =>
            prev.map((c) => (c.id === conversationId
              ? {
                  ...c,
                  unreadCount,
                  ...(manuallyUnread !== undefined ? { manuallyUnread } : {}),
                }
              : c)),
          );
        }

        // Estado alterado fora desta aba: em outro aparelho do usuário ou por outro
        // operador do mesmo tenant. Campo ausente significa "sem informação" — mesclar
        // com false apagaria estado que ninguém mexeu.
        if (payload.event === 'chat.state.updated') {
          const d = payload.data;

          setConversations((prev) => {
            let next = prev.map((c) => (c.id === d.conversationId
              ? {
                  ...c,
                  ...(d.unreadCount    !== undefined ? { unreadCount:    d.unreadCount }    : {}),
                  ...(d.manuallyUnread !== undefined ? { manuallyUnread: d.manuallyUnread } : {}),
                  ...(d.archived       !== undefined ? { archived:       d.archived }       : {}),
                  ...(d.pinned         !== undefined ? { pinned:         d.pinned }         : {}),
                  ...(d.mutedUntil     !== undefined ? { mutedUntil:     d.mutedUntil }     : {}),
                  ...(d.favorite       !== undefined ? { favorite:       d.favorite }       : {}),
                  ...(d.lists          !== undefined ? { lists:          d.lists }          : {}),
                }
              : c));

            // Arquivar não é só um campo: a visão carregada é decidida pelo servidor
            // (GET /conversations?archived=...), então a conversa precisa sair da lista.
            if (d.archived !== undefined && d.archived !== showArchived) {
              next = next.filter((c) => c.id !== d.conversationId);
            }

            if (d.pinned !== undefined) next = [...next].sort(byPinnedThenRecent);
            return next;
          });

          if (d.archived !== undefined && d.archived !== showArchived) {
            setArchivedCount((n) => Math.max(0, n + (d.archived ? 1 : -1)));
            setSelectedId((current) => (current === d.conversationId ? null : current));
          }
        }

        if (payload.event === 'chat.message.status.updated') {
          const { conversationId, messageId } = payload.data;
          const status = payload.data.status.toLowerCase() as MessageStatus;
          // Id fora da lista: o status chegou antes do 202 da mídia. O hook guarda e aplica na
          // troca da bolha. A lista é atualizada igual — a ref pode estar um render atrás.
          // Só conversa carregada: mídia só sai de conversa aberta, e recibos de conversas nunca
          // abertas não viram estado (nem re-render).
          const loaded = messagesRef.current[conversationId];
          if (loaded && !loaded.some((m) => m.id === messageId)) onMediaWsStatus(messageId, status);
          setMessages((prev) => {
            const msgs = prev[conversationId];
            if (!msgs) return prev;
            return {
              ...prev,
              [conversationId]: msgs.map((m) => (m.id === messageId ? { ...m, status } : m)),
            };
          });
        }

        if (payload.event === 'chat.message.reaction.updated') {
          const { conversationId, messageId, reactionsRevision, reactions } = payload.data;
          // Conversa não carregada é ignorada: o GET ao abrir traz o estado real.
          setMessages((prev) =>
            acceptIntoMessages(prev, conversationId, messageId, toAggregate(reactionsRevision, reactions)),
          );
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
      [loadConversations, loadSessions, showArchived, scheduleMarkAsRead, onMediaWsStatus],
    ),
    // Frames perdidos durante a queda não são reenviados: ao voltar, recarrega.
    { onResync: handleResync },
  );

  const selectedConversation = selectedId
    ? conversations.find((c) => c.id === selectedId) ?? null
    : null;

  // Servidor + bolhas em envio (ao fim) → citações resolvidas → reações pendentes por cima.
  const selectedMessages = useMemo(
    () =>
      selectedId
        ? overlayPending(
            resolveQuotedMessages(overlayOutgoing(messages[selectedId] ?? [], outgoingItems)),
            pendingReactions,
          )
        : [],
    [selectedId, messages, pendingReactions, outgoingItems],
  );

  const handleSelectConversation = useCallback(
    (id: string) => {
      if (markAsReadTimer.current) {
        clearTimeout(markAsReadTimer.current);
        markAsReadTimer.current = null;
      }
      setSelectedId(id);
      // Marca lida localmente de imediato — a marcação manual sai junto, senão a
      // conversa continuaria destacada mesmo depois de aberta.
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, unreadCount: 0, manuallyUnread: false } : c)),
      );

      // Persiste no servidor e envia read receipts (double blue tick)
      chatService.markAsRead(id).catch((err: unknown) =>
        console.warn('Erro ao marcar conversa como lida', err),
      );

      // Subscribe to presence updates for this contact
      chatService.subscribePresence(id).catch(() => {});

      // Carrega mensagens se já estiver em cache — apenas dispara scroll. Pela ref: a
      // callback fica estável e a lista de conversas (memoizada) não re-renderiza à toa.
      if (messagesRef.current[id]) {
        requestScroll(false);
        return;
      }

      setLoadingMessages(true);
      chatService
        .listMessages(id, { limit: PAGE_SIZE })
        .then((items) => {
          applyLatestPage(id, items);
          requestScroll(false);
        })
        .catch((err: unknown) => console.error('Erro ao carregar mensagens', err))
        .finally(() => setLoadingMessages(false));
    },
    [applyLatestPage, requestScroll],
  );

  // ── Reações (estado otimista + envio agrupado; regras em reactionsState) ────
  const updatePending = useCallback((messageId: string, action: PendingAction) => {
    setPendingReactions((prev) => {
      const next = reducePending(prev[messageId], action);
      if (next.length > 0) return { ...prev, [messageId]: next };
      if (!(messageId in prev)) return prev;
      const { [messageId]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const enqueueReaction = useReactionDispatcher(
    useCallback(
      (event: ReactionDispatchEvent) => {
        if (event.type === 'sent' || event.type === 'discarded') {
          updatePending(event.messageId, event);
          return;
        }
        updatePending(event.messageId, { type: event.type, requestId: event.requestId });
        if (event.type === 'success') {
          const { conversationId, messageId, reactionsRevision, reactions } = event.result;
          setMessages((prev) =>
            acceptIntoMessages(prev, conversationId, messageId, toAggregate(reactionsRevision, reactions)),
          );
          return;
        }
        const errors = chatStrings.reactions.errors;
        setErrorToast(
          event.code === 'rate_limited' ? errors.rateLimited
          : event.code === 'session_disconnected' ? errors.sessionDisconnected
          : errors.sendFailed,
        );
      },
      [updatePending, setErrorToast],
    ),
  );

  const handleSetReaction = useCallback(
    (message: ChatMessage, emoji: string | null) => {
      // A bolha recebe a mensagem com o otimista por cima; a base do envio é a do servidor.
      // Sem a versão do servidor não há base confiável: a recebida pode ter o otimista por cima.
      const server = (messages[message.conversationId] ?? []).find((m) => m.id === message.id);
      if (!server) return;
      const requestId = enqueueReaction(message.id, emoji, {
        revision: server.reactionsRevision ?? null,
        reactions: server.reactions ?? [],
      });
      updatePending(message.id, { type: 'click', requestId, emoji });
    },
    [messages, enqueueReaction, updatePending],
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
        // Funcional: a lista pode ter mudado durante o GET (WS, mídia confirmada).
        setMessages((prev) => {
          const current = prev[selectedId] ?? [];
          const known = new Set(current.map((m) => m.id));
          const merged = resolveQuotedMessages([...mapped.filter((m) => !known.has(m.id)), ...current]);
          return { ...prev, [selectedId]: keepNewerReactions(prev[selectedId], merged) };
        });
        setHasMore((prev) => ({ ...prev, [selectedId]: items.length >= PAGE_SIZE }));
        if (mapped.length > 0) {
          setOldestTimestamp((prev) => ({ ...prev, [selectedId]: mapped[0].timestamp }));
        }
      })
      .catch((err: unknown) => console.error('Erro ao carregar mais mensagens', err))
      .finally(() => setIsLoadingMore(false));
  }, [selectedId, isLoadingMore, hasMore, oldestTimestamp]);

  const handleSendMessage = useCallback(
    (text: string, quotedMessageId?: string | null, mentions?: string[]) => {
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
        .sendMessage(selectedId, text, quotedMessageId ?? undefined, mentions)
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

  // ── Anexos: lote da prévia, cancelar, reenviar e descartar ─────────────────
  const handleSendAttachments = useCallback(
    (items: AttachmentSendItem[], quotedMessageId: string | null) => {
      if (!selectedId || items.length === 0) return;
      enqueueMedia(
        selectedId,
        items.map((item, index) => ({
          file: item.file,
          caption: item.caption,
          classification: item.classification,
          // Citação só no 1º item do lote, como no WhatsApp.
          quotedMessageId: index === 0 ? (quotedMessageId ?? undefined) : undefined,
        })),
      );
      requestScroll(true);
    },
    [selectedId, enqueueMedia, requestScroll],
  );

  /** Nota de voz do gravador (no layout) entrou na fila: rola ao fim se a conversa ainda está aberta. */
  const handleVoiceEnqueued = useCallback(
    (conversationId: string) => {
      if (selectedIdRef.current === conversationId) requestScroll(true);
    },
    [requestScroll],
  );

  const handleCancelUpload = useCallback((message: ChatMessage) => cancelMediaUpload(message.id), [cancelMediaUpload]);
  const handleDiscardUpload = useCallback((message: ChatMessage) => discardMediaUpload(message.id), [discardMediaUpload]);

  /**
   * "Tentar de novo". Bolha local → o hook retoma/reconfirma. Mensagem gravada com falha →
   * `POST /retry`: a bolha vira `sending` na hora e o status do 202 é ignorado (o WS pode ter
   * chegado antes com SENT/FAILED); só volta a `failed` se a chamada falhar.
   */
  const handleRetryMessage = useCallback(
    (message: ChatMessage) => {
      if (message.upload) {
        retryMediaUpload(message.id);
        return;
      }
      const { conversationId, id } = message;
      const moveStatus = (from: MessageStatus, to: MessageStatus) =>
        setMessages((prev) => {
          const list = prev[conversationId];
          if (!list?.some((m) => m.id === id && m.status === from)) return prev;
          return {
            ...prev,
            [conversationId]: list.map((m) => (m.id === id && m.status === from ? { ...m, status: to } : m)),
          };
        });

      moveStatus('failed', 'sending');
      retryServerMessage(message).catch((err: unknown) => {
        console.error('Erro ao reenviar a mensagem', err);
        moveStatus('sending', 'failed');
        const code = (err as { code?: string } | null)?.code;
        setErrorToast(
          code === 'SESSION_NOT_CONNECTED'
            ? chatStrings.upload.errors.sessionDisconnected
            : chatStrings.upload.errors.generic,
        );
      });
    },
    [retryMediaUpload, retryServerMessage, setErrorToast],
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

  /**
   * Salto a partir de um resultado da busca.
   *
   * Se a mensagem já está carregada, basta destacar — o MessageList rola até ela.
   * Caso contrário, busca a janela ao redor no servidor e substitui a lista: a
   * mensagem pode estar muito atrás no histórico, fora de qualquer página carregada.
   */
  const handleJumpToMessage = useCallback(
    (messageId: string) => {
      if (!selectedId) return;

      const already = (messages[selectedId] ?? []).some((m) => m.id === messageId);
      if (already) {
        setHighlightMessageId(messageId);
        return;
      }

      setLoadingMessages(true);
      chatService
        .listMessages(selectedId, { around: messageId, limit: PAGE_SIZE })
        .then((items) => {
          const mapped = resolveQuotedMessages(items.map(apiMessageToFrontend));
          setMessages((prev) => ({ ...prev, [selectedId]: keepNewerReactions(prev[selectedId], mapped) }));
          if (mapped.length > 0) {
            setOldestTimestamp((prev) => ({ ...prev, [selectedId]: mapped[0].timestamp }));
          }
          // A janela ao redor não é o fim da conversa: ainda há mensagens anteriores.
          setHasMore((prev) => ({ ...prev, [selectedId]: true }));
          setHighlightMessageId(messageId);
        })
        .catch((err: unknown) => console.error('Erro ao carregar a mensagem', err))
        .finally(() => setLoadingMessages(false));
    },
    [selectedId, messages],
  );

  // O destaque é temporário: some sozinho depois da animação.
  useEffect(() => {
    if (!highlightMessageId) return;
    const timer = setTimeout(() => setHighlightMessageId(null), 2000);
    return () => clearTimeout(timer);
  }, [highlightMessageId]);

  const actionsConversation = actionsFor
    ? conversations.find((c) => c.id === actionsFor.id) ?? null
    : null;

  // Nomes do catálogo ∪ os gravados nas conversas carregadas: entre uma recarga e outra
  // nenhum nome some (uma lista recém-gravada numa conversa aparece antes do catálogo voltar).
  const knownLists = useMemo(
    () => collectKnownLists([...conversations, { lists: lists.map((l) => l.name) }]),
    [conversations, lists],
  );
  // Catálogo para o ▾ da barra lateral: contagem do servidor, com os nomes que só as
  // conversas carregadas conhecem entrando com a contagem local.
  const sidebarLists = useMemo(() => {
    const byName = new Map(lists.map((l) => [l.name, l.conversationCount]));
    return knownLists.map((name) => ({
      name,
      count: byName.get(name) ?? conversations.filter((c) => c.lists?.includes(name)).length,
    }));
  }, [knownLists, lists, conversations]);

  const handleConversationStateChange = useCallback(
    (conversationId: string, change: ConversationStateChange) => {
      // Atualização otimista: a interface responde na hora e a lista é recarregada
      // depois, porque arquivar e fixar mudam a composição e a ordem dela.
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                ...(change.archived !== undefined ? { archived: change.archived } : {}),
                ...(change.pinned !== undefined ? { pinned: change.pinned } : {}),
                ...(change.favorite !== undefined ? { favorite: change.favorite } : {}),
                ...(change.lists !== undefined ? { lists: change.lists } : {}),
                ...(change.unread !== undefined ? { manuallyUnread: change.unread } : {}),
                ...(change.muteMs !== undefined
                  ? { mutedUntil: change.muteMs === null ? null : new Date(Date.now() + change.muteMs).toISOString() }
                  : {}),
              }
            : c,
        ),
      );

      // Arquivar tira a conversa da visão atual e fixar reordena — as duas coisas
      // são resolvidas localmente, sem recarregar a lista inteira.
      if (change.archived !== undefined) {
        const leftTheList = change.archived !== showArchived;
        if (leftTheList) {
          setConversations((prev) => prev.filter((c) => c.id !== conversationId));
          setArchivedCount((n) => Math.max(0, n + (change.archived ? 1 : -1)));
          setSelectedId((current) => (current === conversationId ? null : current));
        }
      }

      if (change.pinned !== undefined) {
        setConversations((prev) => [...prev].sort(byPinnedThenRecent));
      }

      chatService
        .updateConversationState(conversationId, change)
        .then(() => {
          // Um nome novo gravado por aqui também entra no catálogo; as contagens mudam sempre.
          if (change.lists !== undefined) void loadLists();
        })
        .catch((err: unknown) => {
          // A lista local já mudou: só nesse caso vale recarregar, para não deixar a
          // interface divergindo do servidor.
          console.error('Erro ao atualizar a conversa', err);
          void loadConversations();
        });
    },
    [loadConversations, loadLists, showArchived],
  );

  // Grava `lists` em lote: otimista, `allSettled`, as que falharem voltam ao estado anterior
  // e o snackbar avisa. Resolve com quantas entraram, para quem chamou decidir o filtro.
  const commitListPlan = useCallback(
    (
      base: ReadonlyArray<Pick<ChatConversation, 'id' | 'lists'>>,
      plan: ListUpdatePlan[],
      failureMessage: (failed: number) => string,
    ): Promise<number> => {
      const previousLists = new Map<string, string[] | undefined>();
      for (const c of base) if (plan.some((p) => p.id === c.id)) previousLists.set(c.id, c.lists);
      const nextLists = new Map(plan.map((p) => [p.id, p.lists]));

      setConversations((prev) =>
        prev.map((c) => (nextLists.has(c.id) ? { ...c, lists: nextLists.get(c.id) } : c)),
      );

      return Promise.allSettled(
        plan.map((p) => chatService.updateConversationState(p.id, { lists: p.lists })),
      ).then((results) => {
        const failedIds = plan.filter((_, i) => results[i].status === 'rejected').map((p) => p.id);
        if (failedIds.length > 0) {
          console.error('Erro ao gravar a lista', results.find((r) => r.status === 'rejected'));
          setConversations((prev) =>
            prev.map((c) => (failedIds.includes(c.id) ? { ...c, lists: previousLists.get(c.id) } : c)),
          );
          setErrorToast(failureMessage(failedIds.length));
        }
        return plan.length - failedIds.length;
      });
    },
    [setErrorToast],
  );

  // Referência para a API: pelo id do catálogo; um nome ainda só em `tags` vai pelo nome.
  const listRef = useCallback(
    (name: string) => {
      const id = lists.find((l) => l.name === name)?.id ?? null;
      return id ? { id } : { name };
    },
    [lists],
  );

  // Erro do catálogo vira snackbar; 409 é colisão de nome. Nada muda localmente.
  const reportListError = useCallback(
    (err: unknown, name: string, fallback: (name: string) => string) => {
      console.error('Erro no catálogo de listas', err);
      const conflict = isAxiosError(err) && err.response?.status === 409;
      setErrorToast(conflict ? chatStrings.lists.errors.nameExists(name) : fallback(name));
    },
    [setErrorToast],
  );

  // Cria a lista no catálogo antes de gravar os membros: uma lista sem conversa é válida
  // e persiste. Se a criação falhar, nada muda localmente. O filtro liga se alguma entrou.
  const handleCreateList = useCallback(
    async (name: string, conversationIds: string[]) => {
      try {
        await chatService.createList(name);
      } catch (err) {
        reportListError(err, name, chatStrings.lists.errors.createFailed);
        return;
      }
      const plan = planListMembers(conversations, name, conversationIds);
      const ok = await commitListPlan(conversations, plan, (failed) => chatStrings.lists.partialFailure(name, failed));
      await loadLists();
      if (ok > 0) setFilter(listFilter(name));
    },
    [conversations, commitListPlan, loadLists, reportListError],
  );

  // Edita uma lista. Nome novo → `renameList`: o servidor renomeia em cascata em todas as
  // conversas do tenant e o painel só espelha. Depois, a diferença de membros entre as
  // conversas carregadas vai conversa a conversa (`planListMembers`).
  const handleUpdateList = useCallback(
    async (oldName: string, newName: string, conversationIds: string[]) => {
      let base = conversations;
      if (newName !== oldName) {
        try {
          await chatService.renameList(listRef(oldName), newName);
        } catch (err) {
          reportListError(err, newName, chatStrings.lists.errors.renameFailed);
          return;
        }
        base = applyListRename(conversations, oldName, newName);
        setConversations((prev) => applyListRename(prev, oldName, newName));
        setLists((prev) => prev.map((l) => (l.name === oldName ? { ...l, name: newName } : l)));
        setFilter((current) => (listFilterName(current) === oldName ? listFilter(newName) : current));
      }
      const plan = planListMembers(base, newName, conversationIds);
      await commitListPlan(base, plan, (failed) => chatStrings.lists.updatePartialFailure(newName, failed));
      await loadLists();
    },
    [conversations, commitListPlan, listRef, loadLists, reportListError],
  );

  // Exclui a lista no catálogo (cascata no servidor) e espelha nas conversas carregadas;
  // o filtro dela volta a Todos. Se a API falhar, nada muda.
  const handleDeleteList = useCallback(
    async (name: string) => {
      try {
        await chatService.deleteList(listRef(name));
      } catch (err) {
        reportListError(err, name, chatStrings.lists.errors.deleteFailed);
        return;
      }
      setConversations((prev) => applyListRemoval(prev, name));
      setLists((prev) => prev.filter((l) => l.name !== name));
      setFilter((current) => (listFilterName(current) === name ? 'all' : current));
      await loadLists();
    },
    [listRef, loadLists, reportListError],
  );

  // Abre a conversa direta com um participante de grupo pelo telefone
  const handleParticipantClick = useCallback(
    (phone: string, name: string) => {
      const existing = conversations.find((c) => c.contact.phone === phone && !c.isGroup);
      if (existing) {
        handleSelectConversation(existing.id);
        return;
      }

      // Sem conversa prévia, abre uma pela mesma sessão do grupo de origem. Antes a
      // ação simplesmente não levava a lugar nenhum.
      const sessionId =
        conversations.find((c) => c.id === selectedId)?.session?.id
        ?? selectedSessionId
        ?? connectedSessions[0]?.id;
      if (!sessionId) return;

      chatService
        .startConversation({ sessionId, phone, name })
        .then(async (conversationId) => {
          // A lista precisa chegar antes da seleção: loadConversations descarta o id
          // selecionado quando ele ainda não consta na lista.
          await loadConversations();
          handleSelectConversation(conversationId);
        })
        .catch((err: unknown) => console.error('Erro ao abrir conversa com o contato', err));
    },
    [conversations, handleSelectConversation, selectedId, selectedSessionId, connectedSessions, loadConversations],
  );

  // Gravador de voz do layout: a conversa aberta chega a ele; sair da página (ou da conversa)
  // gravando guarda o áudio como rascunho dela.
  useVoiceRecorderBinding({
    activeConversationId: selectedConversation?.id ?? null,
    available: mediaUpload.config?.capabilities.voiceNotes === true,
    maxSeconds: mediaUpload.config?.maxVoiceSeconds,
    onNotice: showNotice,
    onEnqueued: handleVoiceEnqueued,
  });

  // Callbacks estáveis para a lista de conversas memoizada.
  const openNewConversation = useCallback(() => setNewConversationOpen(true), []);
  const openConversationActions = useCallback(
    (id: string, anchor: HTMLElement) => setActionsFor({ id, anchor }),
    [],
  );
  const handleToggleArchived = useCallback((show: boolean) => {
    setShowArchived(show);
    // Sair de uma conversa arquivada ao trocar de visão evita mostrar uma
    // conversa que não pertence à lista exibida.
    setSelectedId(null);
  }, []);

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
        // Anula o padding do wrapper de conteúdo nos quatro lados: sem o topo, sobrava
        // uma faixa vazia entre a topbar e a lista de conversas.
        m: { xs: -2, sm: -3, md: -4 },
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
      <MentionNamesContext.Provider value={knownMentionNames}>
      <ConversationSidebar
        conversations={conversations}
        selectedId={selectedId}
        onSelect={handleSelectConversation}
        sessions={sessionOptions}
        selectedSessionId={selectedSessionId}
        onSessionChange={setSelectedSessionId}
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={setFilter}
        loading={loadingConversations}
        presenceMap={presenceMap}
        archivedCount={archivedCount}
        showArchived={showArchived}
        onNewConversation={openNewConversation}
        onOpenActions={openConversationActions}
        onToggleArchived={handleToggleArchived}
        knownLists={knownLists}
        lists={sidebarLists}
        onCreateList={handleCreateList}
        onUpdateList={handleUpdateList}
        onDeleteList={handleDeleteList}
      />
      </MentionNamesContext.Provider>
      </Box>

      {/* Área central — no mobile ocupa a tela quando há conversa selecionada */}
      {selectedConversation ? (
        <ChatWindow
          conversation={selectedConversation}
          messages={selectedMessages}
          onSendMessage={handleSendMessage}
          detailsOpen={detailsOpen}
          onToggleDetails={() => {
            setDetailsOpen((v) => {
              const next = !v;
              if (next) setSearchPanelOpen(false);
              return next;
            });
          }}
          loadingMessages={loadingMessages}
          presence={presenceMap[selectedConversation.contact.phone]}
          hasMore={selectedId ? (hasMore[selectedId] ?? false) : false}
          isLoadingMore={isLoadingMore}
          onLoadMore={handleLoadMore}
          scrollSignal={scrollSignal}
          onParticipantClick={handleParticipantClick}
          participantAvatars={participantAvatars}
          participantNames={knownMentionNames}
          highlightMessageId={highlightMessageId}
          onBack={() => setSelectedId(null)}
          onToggleSearch={() => {
            setSearchPanelOpen((v) => {
              const next = !v;
              // Busca e contexto disputam a mesma coluna: abrir um fecha o outro.
              if (next) setDetailsOpen(false);
              return next;
            });
          }}
          searchOpen={searchPanelOpen}
          onSetReaction={handleSetReaction}
          mediaConfig={mediaUpload.config}
          onSendAttachments={handleSendAttachments}
          onCancelUpload={handleCancelUpload}
          onRetryMessage={handleRetryMessage}
          onDiscardUpload={handleDiscardUpload}
        />
      ) : (
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, flex: 1, minWidth: 0 }}>
          <EmptyConversationState />
        </Box>
      )}

      {actionsConversation && (
        <ConversationActionsMenu
          conversation={actionsConversation}
          anchorEl={actionsFor?.anchor ?? null}
          onClose={() => setActionsFor(null)}
          knownLists={knownLists}
          onChange={(change) => handleConversationStateChange(actionsConversation.id, change)}
        />
      )}

      <NewConversationDialog
        open={newConversationOpen}
        onClose={() => setNewConversationOpen(false)}
        sessions={sessionOptions}
        defaultSessionId={selectedSessionId}
        onCreated={async (conversationId) => {
          await loadConversations();
          handleSelectConversation(conversationId);
        }}
      />

      {/* Busca de mensagens da conversa — ocupa a mesma coluna do contexto */}
      {selectedConversation && searchPanelOpen && (
        <Box
          sx={{
            display: 'flex',
            position: { xs: 'absolute', sm: 'static' },
            inset: { xs: 0, sm: 'auto' },
            zIndex: { xs: 3, sm: 'auto' },
            bgcolor: 'background.paper',
          }}
        >
          <ConversationSearchPanel
            conversationId={selectedConversation.id}
            onClose={() => setSearchPanelOpen(false)}
            onSelectMessage={handleJumpToMessage}
          />
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
          participantsTotal={participantsTotal}
          loadingParticipants={loadingParticipants}
          onStateChange={(change) => handleConversationStateChange(selectedConversation.id, change)}
          knownLists={knownLists}
        />
        </Box>
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          // Só erro interrompe o leitor de tela; aviso e informação entram educados.
          <Alert
            severity={toast.severity}
            variant="filled"
            role={toast.severity === 'error' ? 'alert' : 'status'}
            onClose={() => setToast(null)}
          >
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
