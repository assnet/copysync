import { useEffect, useRef, useCallback, useState } from 'react';
import { Box, CircularProgress, Typography, Fab, alpha, useTheme } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import type { ChatMessage } from '../types';
import { MessageBubble } from './MessageBubble';
import { formatDateSeparator } from '../utils';

interface Props {
  messages: ChatMessage[];
  loading?: boolean;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** Sinal de rolagem: `n` incrementa a cada pedido, `smooth` define se anima. */
  scrollSignal?: { n: number; smooth: boolean };
  onReply?: (message: ChatMessage) => void;
  onParticipantClick?: (phone: string, name: string) => void;
  participantAvatars?: Record<string, string>;
  /** Mensagem a destacar e para onde rolar (vinda da busca). */
  highlightMessageId?: string | null;
}

function isSameDay(a: string, b: string) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

// ── Date separator ────────────────────────────────────────────────────────────

function DateSeparator({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 3, my: 2 }}>
      <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
      <Box
        sx={{
          px: 1.5,
          py: 0.35,
          borderRadius: 3,
          bgcolor: alpha(theme.palette.text.primary, 0.05),
          border: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Typography variant="caption" color="text.secondary" fontWeight={500} sx={{ fontSize: 11 }}>
          {label}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
    </Box>
  );
}

// ── Message list ──────────────────────────────────────────────────────────────

export function MessageList({
  messages,
  loading = false,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  scrollSignal,
  onReply,
  onParticipantClick,
  participantAvatars,
  highlightMessageId,
}: Props) {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevScrollHeight = useRef<number>(0);
  const wasLoadingMore = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Rola ao fundo a cada novo sinal. A animação é decidida por quem pede: abrir uma
  // conversa salta direto para o fim ('auto'), mensagem nova numa conversa aberta anima.
  const scrollN = scrollSignal?.n ?? 0;
  const scrollSmooth = scrollSignal?.smooth ?? false;
  useEffect(() => {
    if (!scrollN) return;
    // Defer um frame para garantir que o DOM já pintou a nova mensagem
    const raf = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: scrollSmooth ? 'smooth' : 'auto' });
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollN, scrollSmooth]);

  // Salto vindo da busca: rola até a mensagem e a destaca por um instante.
  useEffect(() => {
    if (!highlightMessageId) return;
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${highlightMessageId}"]`,
    );
    if (!el) return;

    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [highlightMessageId, messages]);

  // Preserve scroll position after prepend (when older messages loaded)
  useEffect(() => {
    if (wasLoadingMore.current && !isLoadingMore && containerRef.current) {
      const newHeight = containerRef.current.scrollHeight;
      containerRef.current.scrollTop += newHeight - prevScrollHeight.current;
    }
    wasLoadingMore.current = isLoadingMore;
  }, [isLoadingMore, messages]);

  // Detect scroll near top → load more; detect distance from bottom → show FAB
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    // Mostra botão quando o usuário subiu mais de 300px do fundo
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 300);
    // Carrega mais mensagens ao chegar perto do topo
    if (hasMore && !isLoadingMore && onLoadMore && el.scrollTop < 80) {
      prevScrollHeight.current = el.scrollHeight;
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, onLoadMore]);

  const handleScrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return (
    <Box
      ref={containerRef}
      onScroll={handleScroll}
      sx={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        py: 1.5,
        bgcolor: 'background.default',
      }}
    >
      {/* Top loader spinner */}
      {isLoadingMore && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
          <CircularProgress size={20} color="inherit" sx={{ opacity: 0.4 }} />
        </Box>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
          <Typography variant="body2" color="text.disabled">Carregando mensagens...</Typography>
        </Box>
      ) : messages.length === 0 ? (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
          <Typography variant="body2" color="text.disabled">Nenhuma mensagem nesta conversa.</Typography>
        </Box>
      ) : (
        messages.map((msg, index) => {
          const prevMsg = messages[index - 1];
          const showDateSep = !prevMsg || !isSameDay(prevMsg.timestamp, msg.timestamp);

          return (
            <Box
              key={msg.id}
              data-message-id={msg.id}
              sx={
                highlightMessageId === msg.id
                  ? {
                      // Destaque breve: some sozinho, sem exigir ação de quem leu.
                      animation: 'messageFlash 1.6s ease-out',
                      '@keyframes messageFlash': {
                        '0%':   { backgroundColor: alpha(theme.palette.primary.main, 0.22) },
                        '70%':  { backgroundColor: alpha(theme.palette.primary.main, 0.22) },
                        '100%': { backgroundColor: 'transparent' },
                      },
                    }
                  : undefined
              }
            >
              {showDateSep && <DateSeparator label={formatDateSeparator(msg.timestamp)} />}
              <MessageBubble
                message={msg}
                onReply={onReply}
                onParticipantClick={onParticipantClick}
                participantAvatars={participantAvatars}
              />
            </Box>
          );
        })
      )}
      <div ref={bottomRef} />

      {/* Botão flutuante para rolar ao fundo */}
      {showScrollBtn && (
        <Fab
          size="small"
          onClick={handleScrollToBottom}
          title="Ir para as mensagens mais recentes"
          sx={{
            position: 'sticky',
            bottom: 12,
            alignSelf: 'flex-end',
            mr: 2,
            zIndex: 10,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: 3,
            color: 'text.secondary',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <KeyboardArrowDownIcon />
        </Fab>
      )}
    </Box>
  );
}
