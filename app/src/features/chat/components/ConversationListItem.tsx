import { Box, Avatar, Typography, Badge, Chip, IconButton, alpha, useTheme } from '@mui/material';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import PushPinIcon from '@mui/icons-material/PushPin';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import FavoriteIcon from '@mui/icons-material/Favorite';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import type { ChatConversation } from '../types';
import { getStatusConfig, formatConversationTime, formatPhone } from '../utils';

interface Props {
  /** Abre o menu de ações da conversa, ancorado no botão. */
  onOpenActions?: (anchor: HTMLElement) => void;
  conversation: ChatConversation;
  selected: boolean;
  onClick: () => void;
  presence?: string;
}

export function ConversationListItem({ conversation, selected, onClick, presence, onOpenActions }: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { contact, status, unreadCount, lastMessage, lastMessageAt, tags, assignedTo } = conversation;
  const statusConfig = getStatusConfig(status);
  const hasUnread = unreadCount > 0;
  const isGroup = conversation.isGroup ?? false;
  const isMuted = Boolean(conversation.mutedUntil && new Date(conversation.mutedUntil) > new Date());
  // Contato sem nome salvo tem o próprio número como nome: nesse caso exibimos o
  // telefone formatado, como faz o WhatsApp Web, em vez do número cru.
  const displayTitle = isGroup
    ? (conversation.groupName ?? contact.name)
    : /^[\d\s+()-]+$/.test(contact.name)
      ? formatPhone(contact.phone || contact.name)
      : contact.name;

  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        px: 2,
        py: 1.5,
        cursor: 'pointer',
        borderLeft: '3px solid',
        borderLeftColor: selected ? 'primary.main' : 'transparent',
        bgcolor: selected
          ? alpha(theme.palette.primary.main, isDark ? 0.12 : 0.07)
          : 'transparent',
        '&:hover': {
          bgcolor: selected
            ? alpha(theme.palette.primary.main, isDark ? 0.16 : 0.1)
            : alpha(theme.palette.text.primary, 0.04),
        },
        transition: 'background-color 0.15s',
      }}
    >
      {/* Avatar with status dot */}
      <Box sx={{ position: 'relative', flexShrink: 0, mt: 0.25 }}>
        <Avatar
          src={contact.avatarUrl ?? undefined}
          sx={{
            width: 42,
            height: 42,
            bgcolor: isGroup ? 'success.main' : (contact.avatarColor ?? 'primary.main'),
            fontSize: 15,
            fontWeight: 700,
          }}
        >
          {isGroup ? <GroupsOutlinedIcon sx={{ fontSize: 22 }} /> : contact.initials}
        </Avatar>
        {/* Status dot */}
        <Box
          sx={{
            position: 'absolute',
            bottom: 1,
            right: 1,
            width: 11,
            height: 11,
            borderRadius: '50%',
            bgcolor: statusConfig.color,
            border: `2px solid ${theme.palette.background.paper}`,
          }}
        />
      </Box>

      {/* Content — nome, número e preview com respiro uniforme entre as linhas */}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {/* Row 1: Name + time */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography
            variant="body2"
            fontWeight={hasUnread ? 700 : 500}
            noWrap
            sx={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}
          >
            {displayTitle}
          </Typography>
          <Typography
            variant="caption"
            color={hasUnread ? 'primary.main' : 'text.disabled'}
            fontWeight={hasUnread ? 700 : 400}
            sx={{ flexShrink: 0 }}
          >
            {formatConversationTime(lastMessageAt)}
          </Typography>
          {conversation.favorite && (
            <FavoriteIcon sx={{ fontSize: 13, color: 'error.light', flexShrink: 0 }} titleAccess="Favorita" />
          )}
          {isMuted && (
            <NotificationsOffIcon sx={{ fontSize: 14, color: 'text.disabled', flexShrink: 0 }} titleAccess="Silenciada" />
          )}
          {conversation.pinned && (
            <PushPinIcon sx={{ fontSize: 14, color: 'text.disabled', flexShrink: 0 }} titleAccess="Fixada" />
          )}
          {onOpenActions && (
            <IconButton
              size="small"
              aria-label="Ações da conversa"
              onClick={(e) => {
                // O clique é do botão, não da conversa: sem isso abrir o menu também
                // selecionaria a conversa.
                e.stopPropagation();
                onOpenActions(e.currentTarget);
              }}
              sx={{
                p: 0.25,
                ml: -0.25,
                flexShrink: 0,
                // Aparece no hover no desktop; no toque fica sempre visível, já que
                // não existe hover.
                opacity: { xs: 1, sm: 0 },
                '.MuiBox-root:hover > * > &': { opacity: 1 },
                transition: 'opacity 0.15s',
              }}
            >
              <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Box>

        {/* Row 2: preview da última mensagem + badge de não lidas, como no WhatsApp Web */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
        {presence === 'composing' ? (
          <Typography
            variant="caption"
            sx={{ color: '#22c55e', fontStyle: 'italic', fontWeight: 500, mt: 0.25 }}
            noWrap
            display="block"
          >
            digitando…
          </Typography>
        ) : presence === 'recording' ? (
          <Typography
            variant="caption"
            sx={{ color: '#ef4444', fontStyle: 'italic', fontWeight: 500, mt: 0.25 }}
            noWrap
            display="block"
          >
            gravando áudio…
          </Typography>
        ) : (
          <Typography
            variant="caption"
            color={hasUnread ? 'text.primary' : 'text.secondary'}
            fontWeight={hasUnread ? 600 : 400}
            noWrap
            display="block"
            sx={{ mt: 0.25 }}
          >
            {lastMessage}
          </Typography>
        )}
          </Box>
          {hasUnread && (
            <Badge
              badgeContent={unreadCount}
              color="primary"
              max={99}
              sx={{ flexShrink: 0, '& .MuiBadge-badge': { position: 'relative', transform: 'none', fontSize: 10, minWidth: 18, height: 18 } }}
            />
          )}
        </Box>

        {/* Row 3: Tags/indicators */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.75, flexWrap: 'wrap' }}>
          {status === 'bot' && (
            <Chip
              icon={<SmartToyOutlinedIcon style={{ fontSize: 11 }} />}
              label="Bot"
              size="small"
              sx={{
                height: 18,
                fontSize: 10,
                bgcolor: alpha('#3b82f6', 0.12),
                color: '#3b82f6',
                '& .MuiChip-icon': { color: '#3b82f6', ml: '4px' },
              }}
            />
          )}
          {status === 'waiting' && (
            <Chip
              icon={<HourglassEmptyIcon style={{ fontSize: 11 }} />}
              label="Fila"
              size="small"
              sx={{
                height: 18,
                fontSize: 10,
                bgcolor: alpha('#f59e0b', 0.12),
                color: '#f59e0b',
                '& .MuiChip-icon': { color: '#f59e0b', ml: '4px' },
              }}
            />
          )}
          {status === 'closed' && (
            <Chip
              label="Enc."
              size="small"
              sx={{ height: 18, fontSize: 10, bgcolor: alpha('#9096a8', 0.12), color: 'text.disabled' }}
            />
          )}
          {assignedTo && (
            <Chip
              label={assignedTo}
              size="small"
              sx={{ height: 18, fontSize: 10, bgcolor: alpha('#22c55e', 0.1), color: '#22c55e' }}
            />
          )}
          {tags.slice(0, 2).map((tag) => (
            <Chip
              key={tag}
              label={tag}
              size="small"
              sx={{
                height: 18,
                fontSize: 10,
                bgcolor: alpha(theme.palette.text.primary, 0.06),
                color: 'text.secondary',
              }}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
}
