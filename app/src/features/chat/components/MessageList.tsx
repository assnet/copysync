import { useEffect, useRef } from 'react';
import { Box, Typography, alpha, useTheme } from '@mui/material';
import type { ChatMessage } from '../types';
import { MessageBubble } from './MessageBubble';
import { formatDateSeparator } from '../utils';

interface Props {
  messages: ChatMessage[];
  loading?: boolean;
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

export function MessageList({ messages, loading = false }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <Box
      sx={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        py: 1.5,
        bgcolor: 'background.default',
      }}
    >
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
            <Box key={msg.id}>
              {showDateSep && <DateSeparator label={formatDateSeparator(msg.timestamp)} />}
              <MessageBubble message={msg} />
            </Box>
          );
        })
      )}
      <div ref={bottomRef} />
    </Box>
  );
}
