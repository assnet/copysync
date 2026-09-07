import { Box, Avatar, Typography, IconButton, Chip, Tooltip, Divider, Menu, MenuItem, ListItemIcon, ListItemText, alpha, useTheme } from '@mui/material';
import { useState } from 'react';
import type { ReactElement } from 'react';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SearchIcon from '@mui/icons-material/Search';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CircleIcon from '@mui/icons-material/Circle';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RouterOutlinedIcon from '@mui/icons-material/RouterOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import type { ChatConversation } from '../types';
import { formatPhone, getStatusConfig } from '../utils';

interface Props {
  conversation: ChatConversation;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  presence?: string;
  /** Volta para a lista de conversas — usado na navegação por telas do mobile. */
  onBack?: () => void;
  /** Abre/fecha a busca de mensagens da conversa. */
  onToggleSearch?: () => void;
  searchOpen?: boolean;
}

const STATUS_ICON: Record<string, ReactElement> = {
  open:    <CheckCircleOutlineIcon sx={{ fontSize: 13, color: '#22c55e' }} />,
  waiting: <HourglassEmptyIcon sx={{ fontSize: 13, color: '#f59e0b' }} />,
  bot:     <SmartToyOutlinedIcon sx={{ fontSize: 13, color: '#3b82f6' }} />,
  closed:  <CircleIcon sx={{ fontSize: 13, color: '#9096a8' }} />,
  pending: <CircleIcon sx={{ fontSize: 13, color: '#f59e0b' }} />,
};

function getPresenceLabel(presence?: string): { text: string; color: string } | null {
  switch (presence) {
    case 'composing': return { text: 'digitando…', color: '#22c55e' };
    case 'recording': return { text: 'gravando áudio…', color: '#ef4444' };
    case 'available': return { text: 'online', color: '#22c55e' };
    default: return null;
  }
}

export function ChatHeader({ conversation, detailsOpen, onToggleDetails, presence, onBack, onToggleSearch, searchOpen }: Props) {
  const theme = useTheme();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const { contact, session, status, queue, assignedTo } = conversation;
  const statusConfig = getStatusConfig(status);
  const presenceLabel = getPresenceLabel(presence);
  const isGroup = conversation.isGroup ?? false;
  const displayName = isGroup ? (conversation.groupName ?? contact.name) : contact.name;

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2.5,
          py: 1.25,
          bgcolor: 'background.paper',
        }}
      >
        {/* Voltar — só no mobile, onde lista e conversa são telas separadas */}
        {onBack && (
          <IconButton
            onClick={onBack}
            size="small"
            aria-label="Voltar para as conversas"
            sx={{ display: { xs: 'inline-flex', sm: 'none' }, ml: -0.5, mr: -0.5 }}
          >
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        )}

        {/* Avatar — atalho para os dados da conversa, como no WhatsApp Web */}
        <Tooltip title={isGroup ? 'Dados do grupo' : 'Dados do contato'}>
          <Avatar
            src={contact.avatarUrl ?? undefined}
            onClick={onToggleDetails}
            role="button"
            tabIndex={0}
            aria-label={isGroup ? 'Abrir dados do grupo' : 'Abrir dados do contato'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onToggleDetails();
              }
            }}
            sx={{
              width: 40,
              height: 40,
              bgcolor: isGroup ? 'success.main' : (contact.avatarColor ?? 'primary.main'),
              fontSize: 14,
              fontWeight: 700,
              flexShrink: 0,
              cursor: 'pointer',
              transition: 'opacity 0.15s',
              '&:hover': { opacity: 0.85 },
              '&:focus-visible': {
                outline: `2px solid ${theme.palette.primary.main}`,
                outlineOffset: 2,
              },
            }}
          >
            {isGroup ? <GroupsOutlinedIcon sx={{ fontSize: 22 }} /> : contact.initials}
          </Avatar>
        </Tooltip>

        {/* Info — nome e número centrados na linha média do avatar */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body1" fontWeight={700} noWrap sx={{ lineHeight: 1.3 }}>
              {displayName}
            </Typography>
            <Chip
              icon={STATUS_ICON[status] ?? undefined}
              label={statusConfig.label}
              size="small"
              sx={{
                height: 20,
                fontSize: 11,
                fontWeight: 600,
                bgcolor: alpha(statusConfig.color, 0.12),
                color: statusConfig.color,
                '& .MuiChip-icon': { color: statusConfig.color },
                border: `1px solid ${alpha(statusConfig.color, 0.25)}`,
              }}
            />
          </Box>
          {presenceLabel && (
            <Typography
              variant="caption"
              sx={{
                color: presenceLabel.color,
                fontWeight: 500,
                fontStyle: presenceLabel.text !== 'online' ? 'italic' : 'normal',
              }}
            >
              {presenceLabel.text}
            </Typography>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>
              {isGroup ? 'Grupo' : formatPhone(contact.phone)}
            </Typography>
            {session && (
              <>
                <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: 'text.disabled' }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                  <RouterOutlinedIcon sx={{ fontSize: 12, color: 'text.disabled' }} />
                  <Typography variant="caption" color="text.secondary">
                    {session.name}
                  </Typography>
                </Box>
              </>
            )}
            {queue && (
              <>
                <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: 'text.disabled' }} />
                <Typography variant="caption" color="text.secondary">
                  {queue}
                </Typography>
              </>
            )}
            {assignedTo && (
              <>
                <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: 'text.disabled' }} />
                <Typography variant="caption" color="success.main" fontWeight={500}>
                  {assignedTo}
                </Typography>
              </>
            )}
          </Box>
        </Box>

        {/* Actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          <Tooltip title="Buscar na conversa">
            <IconButton
              size="small"
              aria-label="Buscar nesta conversa"
              onClick={onToggleSearch}
              color={searchOpen ? 'primary' : 'default'}
            >
              <SearchIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Mais opções">
            <IconButton
              size="small"
              aria-label="Mais ações"
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              sx={{
                color: menuAnchor ? 'primary.main' : undefined,
                bgcolor: menuAnchor ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
              }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={() => setMenuAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                onToggleDetails();
              }}
            >
              <ListItemIcon>
                <InfoOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={detailsOpen ? 'Fechar dados' : (isGroup ? 'Dados do grupo' : 'Dados do contato')}
                primaryTypographyProps={{ variant: 'body2' }}
              />
            </MenuItem>
          </Menu>
        </Box>
      </Box>
      <Divider />
    </Box>
  );
}
