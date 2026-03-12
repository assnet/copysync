import { useState } from 'react';
import { Box, Typography, alpha, useTheme, IconButton, Tooltip } from '@mui/material';
import DoneIcon from '@mui/icons-material/Done';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ReplyIcon from '@mui/icons-material/Reply';
import type { ChatMessage } from '../types';
import { formatMessageTime } from '../utils';
import { ImageMessage } from './messages/ImageMessage';
import { AudioMessage } from './messages/AudioMessage';
import { DocumentMessage } from './messages/DocumentMessage';
import { VideoMessage } from './messages/VideoMessage';
import { StickerMessage } from './messages/StickerMessage';
import { LocationMessage } from './messages/LocationMessage';
import { VCardMessage } from './messages/VCardMessage';
import { CallLogMessage } from './messages/CallLogMessage';
import { DeletedMessage } from './messages/DeletedMessage';
import { QuotedMessage } from './messages/QuotedMessage';

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

// ── Message content renderer ──────────────────────────────────────────────────

interface ContentProps {
  message: ChatMessage;
  isOut: boolean;
  textColor: string;
}

function MessageContent({ message, isOut, textColor }: ContentProps) {
  if (message.isDeleted) {
    return <DeletedMessage isOut={isOut} />;
  }

  switch (message.type) {
    case 'image':
      return (
        <ImageMessage
          mediaUrl={message.mediaUrl}
          body={message.body}
          isOut={isOut}
          textColor={textColor}
        />
      );
    case 'audio':
      return (
        <AudioMessage
          mediaUrl={message.mediaUrl}
          mimeType={message.mimeType}
          durationSeconds={message.durationSeconds}
          isOut={isOut}
        />
      );
    case 'document':
      return (
        <DocumentMessage
          mediaUrl={message.mediaUrl}
          fileName={message.fileName}
          mimeType={message.mimeType}
          body={message.body}
          textColor={textColor}
        />
      );
    case 'video':
      return (
        <VideoMessage
          mediaUrl={message.mediaUrl}
          mimeType={message.mimeType}
          durationSeconds={message.durationSeconds}
          body={message.body}
          textColor={textColor}
        />
      );
    case 'sticker':
      return <StickerMessage mediaUrl={message.mediaUrl} isOut={isOut} />;
    case 'location':
      return <LocationMessage body={message.body} textColor={textColor} />;
    case 'vcard':
      return <VCardMessage body={message.body} textColor={textColor} />;
    case 'call_log':
      return null;
    case 'text':
    case 'event':
    default:
      return message.body ? (
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
      ) : null;
  }
}

// ── Main bubble ───────────────────────────────────────────────────────────────

interface Props {
  message: ChatMessage;
  onReply?: (message: ChatMessage) => void;
}

export function MessageBubble({ message, onReply }: Props) {
  const [hovered, setHovered] = useState(false);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const isOut = message.direction === 'out';

  // Call log — pill centralizado
  if (message.type === 'call_log') {
    return <CallLogMessage body={message.body} isOut={isOut} />;
  }

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

  const bgColor = isOut
    ? theme.palette.primary.main
    : isDark
    ? alpha('#ffffff', 0.09)
    : alpha('#000000', 0.06);

  const textColor = isOut ? '#ffffff' : theme.palette.text.primary;
  const timeColor = isOut ? alpha('#ffffff', 0.65) : theme.palette.text.disabled;

  const replyBtn = onReply && (
    <Tooltip title="Responder" placement={isOut ? 'left' : 'right'}>
      <IconButton
        size="small"
        onClick={() => onReply(message)}
        sx={{
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.15s',
          pointerEvents: hovered ? 'auto' : 'none',
          width: 28,
          height: 28,
          color: 'text.secondary',
          flexShrink: 0,
          alignSelf: 'center',
          '&:hover': { color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.08) },
        }}
      >
        <ReplyIcon sx={{ fontSize: 16, ...(isOut ? { transform: 'scaleX(-1)' } : {}) }} />
      </IconButton>
    </Tooltip>
  );

  return (
    <Box
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      sx={{
        display: 'flex',
        justifyContent: isOut ? 'flex-end' : 'flex-start',
        alignItems: 'center',
        gap: 0.25,
        px: 2.5,
        mb: 0.5,
      }}
    >
      {/* Reply btn à esquerda para mensagens enviadas */}
      {isOut && replyBtn}
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
        {/* Mensagem citada (reply preview) */}
        {message.quotedMessage && (
          <QuotedMessage quoted={message.quotedMessage} isOut={isOut} />
        )}

        {/* Conteúdo da mensagem */}
        <MessageContent message={message} isOut={isOut} textColor={textColor} />

        {/* Footer: hora + tick de status */}
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

      {/* Reply btn à direita para mensagens recebidas */}
      {!isOut && replyBtn}
    </Box>
  );
}
