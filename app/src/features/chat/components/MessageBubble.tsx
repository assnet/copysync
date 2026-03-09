import { Box, Typography, alpha, useTheme } from '@mui/material';
import DoneIcon from '@mui/icons-material/Done';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import AudiotrackOutlinedIcon from '@mui/icons-material/AudiotrackOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import type { ChatMessage } from '../types';
import { formatMessageTime } from '../utils';

// ── Status icon ───────────────────────────────────────────────────────────────

function MessageStatusIcon({ status }: { status: ChatMessage['status'] }) {
  const theme = useTheme();
  const color =
    status === 'read'   ? theme.palette.primary.main :
    status === 'failed' ? theme.palette.error.main :
    theme.palette.text.disabled;

  const sx = { fontSize: 13, color };

  if (status === 'sending')   return <AccessTimeIcon  sx={sx} />;
  if (status === 'sent')      return <DoneIcon        sx={sx} />;
  if (status === 'delivered') return <DoneAllIcon     sx={sx} />;
  if (status === 'read')      return <DoneAllIcon     sx={sx} />;
  if (status === 'failed')    return <ErrorOutlineIcon sx={{ fontSize: 13, color: theme.palette.error.main }} />;
  return null;
}

// ── Media placeholder ─────────────────────────────────────────────────────────

function MediaPlaceholder({ type }: { type: ChatMessage['type'] }) {
  const theme = useTheme();
  const icons = {
    image:    <ImageOutlinedIcon sx={{ fontSize: 28, color: 'inherit' }} />,
    audio:    <AudiotrackOutlinedIcon sx={{ fontSize: 28, color: 'inherit' }} />,
    document: <DescriptionOutlinedIcon sx={{ fontSize: 28, color: 'inherit' }} />,
  } as const;

  if (type === 'text' || type === 'event' || type === 'sticker') return null;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        p: 1.5,
        bgcolor: alpha(theme.palette.text.primary, 0.06),
        borderRadius: 1.5,
        mb: 1,
        color: 'text.secondary',
      }}
    >
      {icons[type as keyof typeof icons]}
      <Typography variant="caption" color="text.secondary">
        {{
          image:    'Imagem',
          audio:    'Áudio',
          document: 'Documento',
        }[type as string] ?? type}
      </Typography>
    </Box>
  );
}

// ── Main bubble ───────────────────────────────────────────────────────────────

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const isOut = message.direction === 'out';

  // Event / system messages — centered pill
  if (message.isEvent) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', px: 3, my: 1 }}>
        <Box
          sx={{
            px: 2,
            py: 0.5,
            borderRadius: 4,
            bgcolor: alpha(theme.palette.text.primary, 0.06),
          }}
        >
          <Typography variant="caption" color="text.disabled" fontStyle="italic">
            {message.body}
          </Typography>
        </Box>
      </Box>
    );
  }

  // Sent (out) — primary colored bubble aligned right
  // Received (in) — neutral bubble aligned left
  const bgColor = isOut
    ? theme.palette.primary.main
    : isDark
    ? alpha('#ffffff', 0.09)
    : alpha('#000000', 0.06);

  const textColor = isOut ? '#ffffff' : theme.palette.text.primary;
  const timeColor = isOut ? alpha('#ffffff', 0.65) : theme.palette.text.disabled;

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isOut ? 'flex-end' : 'flex-start',
        px: 2.5,
        mb: 0.5,
      }}
    >
      <Box
        sx={{
          maxWidth: '68%',
          minWidth: 80,
          px: 1.5,
          pt: 1,
          pb: 0.75,
          borderRadius: isOut
            ? '16px 16px 4px 16px'
            : '16px 16px 16px 4px',
          bgcolor: bgColor,
          boxShadow: isDark ? 'none' : '0 1px 2px rgba(0,0,0,0.08)',
        }}
      >
        {/* Media placeholder (non-text types) */}
        {message.type !== 'text' && <MediaPlaceholder type={message.type} />}

        {/* Body text */}
        {message.body && (
          <Typography
            variant="body2"
            sx={{
              color: textColor,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 13.5,
              lineHeight: 1.55,
            }}
          >
            {message.body}
          </Typography>
        )}

        {/* Footer: time + status */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 0.4,
            mt: 0.25,
          }}
        >
          <Typography variant="caption" sx={{ fontSize: 10.5, color: timeColor }}>
            {formatMessageTime(message.timestamp)}
          </Typography>
          {isOut && <MessageStatusIcon status={message.status} />}
        </Box>
      </Box>
    </Box>
  );
}
