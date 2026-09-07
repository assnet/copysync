import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, TextField, InputAdornment, Box, Typography,
  Avatar, Chip, CircularProgress, IconButton,
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

/**
 * O tamanho da página é decidido pelo servidor: o cliente apenas segue o cursor
 * assinado que recebe. Alterar a requisição não traz mais registros.
 */

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
  const [cursor, setCursor] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // A carga seguinte é disparada pela rolagem; a trava evita disparos repetidos
  // enquanto uma requisição está em andamento.
  const loadingRef = useRef(false);

  const loadPage = useCallback(
    async (pageCursor: string | null, term: string, replace: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const res = await chatService.listGroupParticipants(conversationId, {
          ...(pageCursor ? { cursor: pageCursor } : {}),
          ...(term ? { search: term } : {}),
        });
        setCount(res.total);
        setCursor(res.nextCursor);
        setMembers((prev) => (replace ? res.participants : [...prev, ...res.participants]));
      } catch {
        if (replace) setMembers([]);
      } finally {
        loadingRef.current = false;
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
      setCursor(null);
      return;
    }
    void loadPage(null, '', true);
  }, [open, loadPage]);

  // Busca refaz a paginação do zero, aguardando a digitação parar.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ top: 0 });
      void loadPage(null, search.trim(), true);
    }, 350);
    return () => clearTimeout(timer);
  }, [search, open, loadPage]);

  // Carrega ao alcançar o fim da lista, durante a rolagem: não há botão para
  // automatizar, e nada é buscado sem o usuário chegar até ali.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!open || !sentinel || !cursor) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadPage(cursor, search.trim(), false);
      },
      { root: scrollRef.current, rootMargin: '80px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [open, cursor, search, loadPage]);

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

        {/* Sentinela do fim da lista: entra em vista quando o usuário chega ao fim. */}
        <Box ref={sentinelRef} sx={{ height: 1 }} />
      </DialogContent>
    </Dialog>
  );
}
