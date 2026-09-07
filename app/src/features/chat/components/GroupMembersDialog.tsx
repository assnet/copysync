import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, TextField, InputAdornment, Box, Typography,
  Avatar, Chip, CircularProgress, IconButton, Button,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import { chatService } from '@/services/chat.service';
import type { GroupParticipantApiDto } from '@/types/chat.api.types';
import { formatPhone } from '../utils';

interface Props {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  /** Total conhecido, exibido enquanto a primeira página não chega. */
  total: number;
}

/** Tamanho da página — o painel nunca recebe a lista inteira do grupo. */
const PAGE = 10;

/**
 * Lista completa de membros, carregada sob demanda.
 *
 * Um grupo pode ter centenas de participantes, e a lista é dado pessoal de todos
 * eles: nada é buscado antes de o operador abrir este diálogo, e mesmo aqui só a
 * página visível trafega.
 */
export function GroupMembersDialog({ open, onClose, conversationId, total }: Props) {
  const [members, setMembers] = useState<GroupParticipantApiDto[]>([]);
  const [count, setCount] = useState(total);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadPage = useCallback(
    async (offset: number, term: string, replace: boolean) => {
      setLoading(true);
      try {
        const res = await chatService.listGroupParticipants(conversationId, {
          limit: PAGE,
          offset,
          ...(term ? { search: term } : {}),
        });
        setCount(res.total);
        // Corta na página mesmo se o servidor devolver mais: a paginação não pode
        // depender da versão da API para valer.
        const page = res.participants.slice(0, PAGE);
        setMembers((prev) => (replace ? page : [...prev, ...page]));
      } catch {
        if (replace) setMembers([]);
      } finally {
        setLoading(false);
      }
    },
    [conversationId],
  );

  // Primeira página ao abrir; fechar limpa para não manter dados de membros em memória.
  useEffect(() => {
    if (!open) {
      setMembers([]);
      setSearch('');
      return;
    }
    void loadPage(0, '', true);
  }, [open, loadPage]);

  // Busca refaz a paginação do zero, aguardando a digitação parar.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ top: 0 });
      void loadPage(0, search.trim(), true);
    }, 350);
    return () => clearTimeout(timer);
  }, [search, open, loadPage]);

  const hasMore = members.length < count;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1.5 }}>
        <IconButton size="small" onClick={onClose} aria-label="Fechar" sx={{ ml: -0.5 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
        {/* component="div": DialogTitle já renderiza um h2, e um h6 dentro dele é
            HTML inválido. */}
        <Typography component="div" variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
          Membros{count > 0 ? ` · ${count}` : ''}
        </Typography>
      </DialogTitle>

      <Box sx={{ px: 3, pb: 1.5 }}>
        <TextField
          fullWidth
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquisar membros…"
          inputProps={{ 'aria-label': 'Pesquisar membros do grupo' }}
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

      <DialogContent ref={scrollRef} dividers sx={{ px: 0, py: 0, maxHeight: 420 }}>
        {members.map((m, i) => (
          <Box
            key={`${m.phone ?? 'lid'}-${i}`}
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 3, py: 1 }}
          >
            <Avatar src={m.avatarUrl ?? undefined} sx={{ width: 36, height: 36, fontSize: 13 }}>
              {m.initials || undefined}
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 0.15 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Typography variant="body2" noWrap sx={{ lineHeight: 1.25 }}>{m.name}</Typography>
                {m.isAdmin && (
                  <Chip
                    label="Admin"
                    size="small"
                    sx={{ height: 16, fontSize: 9, fontWeight: 700, '& .MuiChip-label': { px: 0.6 } }}
                  />
                )}
              </Box>
              {m.phone && (
                <Typography variant="caption" color="text.disabled" noWrap sx={{ lineHeight: 1.25 }}>
                  {formatPhone(m.phone)}
                </Typography>
              )}
            </Box>
          </Box>
        ))}

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={20} />
          </Box>
        )}

        {!loading && members.length === 0 && (
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center', py: 4 }}>
            Nenhum membro encontrado.
          </Typography>
        )}

        {hasMore && !loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
            <Button size="small" onClick={() => void loadPage(members.length, search.trim(), false)}>
              Carregar mais ({count - members.length} restantes)
            </Button>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
