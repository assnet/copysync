import { Box, Avatar, Typography, IconButton, Chip, Tooltip, Divider, alpha, useTheme } from '@mui/material';
import type { ReactElement } from 'react';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SearchIcon from '@mui/icons-material/Search';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CircleIcon from '@mui/icons-material/Circle';
import RouterOutlinedIcon from '@mui/icons-material/RouterOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import type { ChatConversation } from '../types';
import { formatPhone, getStatusConfig } from '../utils';

interface Props {
  conversation: ChatConversation;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  presence?: string;
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

export function ChatHeader({ conversation, detailsOpen, onToggleDetails, presence }: Props) {
  const theme = useTheme();
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
        {/* Avatar */}
        <Avatar
          src={contact.avatarUrl ?? undefined}
          sx={{
            width: 40,
            height: 40,
            bgcolor: isGroup ? 'success.main' : (contact.avatarColor ?? 'primary.main'),
            fontSize: 14,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {isGroup ? <GroupsOutlinedIcon sx={{ fontSize: 22 }} /> : contact.initials}
        </Avatar>

        {/* Info */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body1" fontWeight={700} noWrap>
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
            <Typography variant="caption" color="text.secondary">
              {formatPhone(contact.phone)}
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
            <IconButton size="small">
              <SearchIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Mais opções">
            <IconButton size="small">
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={detailsOpen ? 'Fechar painel' : 'Abrir painel de contexto'}>
            <IconButton
              size="small"
              onClick={onToggleDetails}
              sx={{
                color: detailsOpen ? 'primary.main' : 'text.secondary',
                bgcolor: detailsOpen ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
              }}
            >
              <InfoOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      <Divider />
    </Box>
  );
}
