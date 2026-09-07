import { useEffect, useState } from 'react';
import {
  Box, Typography, TextField, InputAdornment, IconButton, Divider, CircularProgress, alpha, useTheme,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import { chatService } from '@/services/chat.service';
import { apiMessageToFrontend } from '@/types/chat.api.types';
import type { ChatMessage } from '../types';
import { formatConversationTime } from '../utils';

interface Props {
  conversationId: string;
  onClose: () => void;
  /** Chamado ao escolher um resultado, para a conversa rolar até a mensagem. */
  onSelectMessage?: (messageId: string) => void;
}

/** Destaca as ocorrências do termo no trecho, como o WhatsApp Web faz. */
function Highlight({ text, term }: { text: string; term: string }) {
  const theme = useTheme();
  if (!term) return <>{text}</>;

  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === term.toLowerCase() ? (
          <Box
            key={i}
            component="span"
            sx={{ color: theme.palette.primary.main, fontWeight: 700 }}
          >
            {part}
          </Box>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * Busca de mensagens dentro da conversa aberta.
 *
 * A consulta acontece no servidor — buscar só no que já está carregado deixaria de
 * fora o histórico mais antigo, que é justamente o que se procura.
 */
export function ConversationSearchPanel({ conversationId, onClose, onSelectMessage }: Props) {
  const theme = useTheme();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Espera a digitação parar antes de consultar, para não disparar uma busca por tecla.
  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      chatService
        .listMessages(conversationId, { search: trimmed, limit: 50 })
        .then((items) => {
          if (cancelled) return;
          setResults(items.map(apiMessageToFrontend));
          setSearched(true);
        })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 350);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [term, conversationId]);

  // Trocar de conversa começa uma busca nova
  useEffect(() => {
    setTerm('');
    setResults([]);
    setSearched(false);
  }, [conversationId]);

  return (
    <Box
      sx={{
        width: { xs: '100%', sm: 320, md: 360 },
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        height: '100%',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5 }}>
        <IconButton size="small" onClick={onClose} aria-label="Fechar busca">
          <CloseIcon fontSize="small" />
        </IconButton>
        <Typography variant="subtitle2" fontWeight={700}>
          Pesquisar mensagens
        </Typography>
      </Box>

      <Box sx={{ px: 2, pb: 1.5 }}>
        <TextField
          fullWidth
          size="small"
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Pesquisar…"
          inputProps={{ 'aria-label': 'Pesquisar mensagens nesta conversa' }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
              </InputAdornment>
            ),
            sx: { borderRadius: 2, fontSize: 13 },
          }}
        />
      </Box>

      <Divider />

      <Box sx={{ flex: 1, overflowY: 'auto' }} aria-live="polite">
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={22} />
          </Box>
        ) : term.trim().length < 2 ? (
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 2, py: 3, textAlign: 'center' }}>
            Digite ao menos 2 caracteres para pesquisar nesta conversa.
          </Typography>
        ) : searched && results.length === 0 ? (
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 2, py: 3, textAlign: 'center' }}>
            Nenhuma mensagem encontrada.
          </Typography>
        ) : (
          results.map((msg) => (
            <Box
              key={msg.id}
              onClick={() => onSelectMessage?.(msg.id)}
              sx={{
                px: 2,
                py: 1.25,
                cursor: onSelectMessage ? 'pointer' : 'default',
                borderBottom: '1px solid',
                borderColor: 'divider',
                '&:hover': onSelectMessage
                  ? { bgcolor: alpha(theme.palette.primary.main, 0.06) }
                  : undefined,
              }}
            >
              <Typography variant="caption" color="text.disabled" display="block">
                {formatConversationTime(msg.timestamp)}
                {msg.fromParticipantName ? ` · ${msg.fromParticipantName}` : ''}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                <Highlight text={msg.body ?? ''} term={term.trim()} />
              </Typography>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
