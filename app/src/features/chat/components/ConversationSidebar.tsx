import { Box, Typography, TextField, InputAdornment, Divider, Button, Chip, IconButton, ListItemButton, alpha, useTheme } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import type { ChatConversation, ConversationFilter } from '../types';
import { ConversationListItem } from './ConversationListItem';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import { formatPhone } from '../utils';

interface FilterOption {
  value: ConversationFilter;
  label: string;
}

const FILTER_OPTIONS: FilterOption[] = [
  { value: 'all',     label: 'Todos' },
  { value: 'unread',  label: 'Não lidas' },
  { value: 'open',    label: 'Abertas' },
  { value: 'waiting', label: 'Fila' },
  { value: 'bot',     label: 'Bot' },
  { value: 'closed',  label: 'Enc.' },
];

function getFilterCount(conversations: ChatConversation[], filter: ConversationFilter): number {
  if (filter === 'all')     return conversations.length;
  if (filter === 'unread')  return conversations.filter((c) => c.unreadCount > 0).length;
  if (filter === 'open')    return conversations.filter((c) => c.status === 'open').length;
  if (filter === 'waiting') return conversations.filter((c) => c.status === 'waiting').length;
  if (filter === 'bot')     return conversations.filter((c) => c.status === 'bot').length;
  if (filter === 'closed')  return conversations.filter((c) => c.status === 'closed').length;
  return 0;
}

interface Props {
  conversations: ChatConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  sessions: Array<{ id: string; name: string; phone: string | null }>;
  selectedSessionId: string | null;
  onSessionChange: (sessionId: string | null) => void;
  search: string;
  onSearchChange: (value: string) => void;
  filter: ConversationFilter;
  onFilterChange: (filter: ConversationFilter) => void;
  loading?: boolean;
  presenceMap?: Record<string, string>;
  /** Quantidade de conversas arquivadas — mostrada na linha de acesso à seção. */
  archivedCount?: number;
  /** true quando a lista já está exibindo as arquivadas. */
  showArchived?: boolean;
  onToggleArchived?: (show: boolean) => void;
  /** Abre o diálogo de nova conversa. */
  onNewConversation?: () => void;
}

export function ConversationSidebar({
  conversations,
  selectedId,
  onSelect,
  sessions,
  selectedSessionId,
  onSessionChange,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  loading = false,
  presenceMap = {},
  archivedCount = 0,
  showArchived = false,
  onToggleArchived,
  onNewConversation,
}: Props) {
  const theme = useTheme();

  const filtered = conversations.filter((c) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !search ||
      c.contact.name.toLowerCase().includes(q) ||
      c.contact.phone.includes(search) ||
      c.lastMessage.toLowerCase().includes(q);

    const matchesFilter =
      filter === 'all' ||
      (filter === 'unread'  && c.unreadCount > 0) ||
      (filter === 'open'    && c.status === 'open') ||
      (filter === 'waiting' && c.status === 'waiting') ||
      (filter === 'bot'     && c.status === 'bot') ||
      (filter === 'closed'  && c.status === 'closed');

    return matchesSearch && matchesFilter;
  });

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  const renderSessionLabel = (session: { name: string; phone: string | null }): string => {
    const phone = session.phone ? formatPhone(session.phone) : null;
    return phone ? `${session.name} · ${phone}` : session.name;
  };

  return (
    <Box
      sx={{
        // Largura fluida: ocupa a tela no mobile e acompanha o espaço disponível no
        // desktop, em vez de ficar presa em 320px.
        width: { xs: '100%', sm: 300, md: 340, lg: 380 },
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Box sx={{ px: 2, pt: 1.5, pb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {showArchived && onToggleArchived && (
              <IconButton
                size="small"
                aria-label="Voltar para as conversas"
                onClick={() => onToggleArchived(false)}
                sx={{ ml: -0.75 }}
              >
                <ArrowBackIcon fontSize="small" />
              </IconButton>
            )}
            <Typography variant="subtitle1" fontWeight={700}>
              {showArchived ? 'Arquivadas' : 'Conversas'}
            </Typography>
            {totalUnread > 0 && (
              <Chip
                label={totalUnread}
                size="small"
                color="primary"
                sx={{ height: 18, fontSize: 11, fontWeight: 700 }}
              />
            )}
          </Box>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            disableElevation
            onClick={onNewConversation}
            disabled={!onNewConversation}
            sx={{ fontSize: 12, px: 1.25, py: 0.5, minWidth: 'unset', borderRadius: 0.5 }}
          >
            Nova
          </Button>
        </Box>

        {/* Search */}
        <TextField
          size="small"
          fullWidth
          placeholder="Buscar por nome, número ou mensagem..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
              </InputAdornment>
            ),
          }}
          sx={{
            '& .MuiOutlinedInput-root': { borderRadius: 2, fontSize: 13 },
          }}
        />
      </Box>

      <Box sx={{ px: 1.5, pb: 1.25, flexShrink: 0 }}>
        <Typography
          variant="caption"
          sx={{ px: 0.5, mb: 0.75, display: 'block', color: 'text.disabled', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.7 }}
        >
          Sessões ativas
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75, overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' } }}>
          <Chip
            label="Todos"
            size="small"
            onClick={() => onSessionChange(null)}
            sx={{
              height: 28,
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: selectedSessionId === null ? 700 : 500,
              bgcolor: selectedSessionId === null
                ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.1)
                : alpha(theme.palette.text.primary, 0.05),
              color: selectedSessionId === null ? 'primary.main' : 'text.secondary',
              border: selectedSessionId === null
                ? `1px solid ${alpha(theme.palette.primary.main, 0.3)}`
                : '1px solid transparent',
              flexShrink: 0,
            }}
          />
          {sessions.map((session) => {
            const active = selectedSessionId === session.id;
            return (
              <Chip
                key={session.id}
                label={renderSessionLabel(session)}
                size="small"
                onClick={() => onSessionChange(session.id)}
                sx={{
                  height: 28,
                  maxWidth: 220,
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: active ? 700 : 500,
                  bgcolor: active
                    ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.1)
                    : alpha(theme.palette.text.primary, 0.05),
                  color: active ? 'primary.main' : 'text.secondary',
                  border: active ? `1px solid ${alpha(theme.palette.primary.main, 0.3)}` : '1px solid transparent',
                  flexShrink: 0,
                  '& .MuiChip-label': {
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                }}
              />
            );
          })}
        </Box>
      </Box>

      {/* Filters */}
      <Box sx={{ px: 1, pb: 1, display: 'flex', gap: 0.5, overflowX: 'auto', flexShrink: 0,
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {FILTER_OPTIONS.map((opt) => {
          const count = getFilterCount(conversations, opt.value);
          const active = filter === opt.value;
          return (
            <Chip
              key={opt.value}
              label={count > 0 && opt.value !== 'all' ? `${opt.label} ${count}` : opt.label}
              size="small"
              onClick={() => onFilterChange(opt.value)}
              sx={{
                height: 26,
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: active ? 700 : 500,
                bgcolor: active
                  ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.1)
                  : alpha(theme.palette.text.primary, 0.05),
                color: active ? 'primary.main' : 'text.secondary',
                border: active ? `1px solid ${alpha(theme.palette.primary.main, 0.3)}` : '1px solid transparent',
                '&:hover': {
                  bgcolor: active
                    ? alpha(theme.palette.primary.main, 0.2)
                    : alpha(theme.palette.text.primary, 0.08),
                },
                flexShrink: 0,
              }}
            />
          );
        })}
      </Box>

      <Divider />

      {/* Acesso às arquivadas, como no WhatsApp Web: uma linha acima da lista */}
      {!showArchived && (archivedCount ?? 0) > 0 && onToggleArchived && (
        <>
          <ListItemButton
            onClick={() => onToggleArchived(true)}
            // ListItemButton nasce com flex-grow: 1 (feito para viver dentro de um
            // ListItem em linha). Num container em coluna isso o faz esticar na
            // vertical e empurrar a lista para baixo.
            sx={{ px: 2, py: 1.25, flexGrow: 0, flexShrink: 0 }}
          >
            <ArchiveOutlinedIcon sx={{ fontSize: 20, color: 'text.secondary', mr: 1.75 }} />
            <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>
              Arquivadas
            </Typography>
            <Typography variant="caption" color="primary.main" fontWeight={700}>
              {archivedCount}
            </Typography>
          </ListItemButton>
          <Divider />
        </>
      )}

      {/* Conversation list */}
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 6, px: 3, gap: 1.5 }}>
            <Typography variant="body2" color="text.disabled">Carregando...</Typography>
          </Box>
        ) : filtered.length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 6, px: 3, gap: 1.5 }}>
            <ForumOutlinedIcon sx={{ fontSize: 36, color: 'text.disabled', opacity: 0.5 }} />
            <Typography variant="body2" color="text.disabled" textAlign="center">
              {search ? 'Nenhuma conversa encontrada para essa busca.' : 'Nenhuma conversa nessa categoria.'}
            </Typography>
          </Box>
        ) : (
          filtered.map((conv) => (
            <Box key={conv.id}>
              <ConversationListItem
                conversation={conv}
                selected={selectedId === conv.id}
                onClick={() => onSelect(conv.id)}
                presence={presenceMap[conv.contact.phone]}
              />
              <Divider sx={{ mx: 2 }} />
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
