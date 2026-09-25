import { useRef, useState } from 'react';
import { Box, Typography, Avatar, alpha, useTheme, IconButton, Tooltip, Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import DoneIcon from '@mui/icons-material/Done';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ReplyIcon from '@mui/icons-material/Reply';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ChatIcon from '@mui/icons-material/Chat';
import AddReactionOutlinedIcon from '@mui/icons-material/AddReactionOutlined';
import type { ChatMessage, MessageType } from '../types';
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
import { RichMessageText } from './messages/RichMessageText';
import { ReactionBar } from './messages/ReactionBar';
import { MessageReactions } from './messages/MessageReactions';
import { UploadProgressOverlay } from './messages/UploadProgressOverlay';
import { FailedMessageActions, type FailedMessageKind } from './messages/FailedMessageActions';
import { chatStrings } from '../strings';

// ── Status icon ───────────────────────────────────────────────────────────────

/** Gera cor distinta por telefone do participante — igual ao WhatsApp Web */
const PARTICIPANT_PALETTE = [
  '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
  '#2196f3', '#03a9f4', '#00bcd4', '#009688',
  '#4caf50', '#8bc34a', '#ff9800', '#ff5722',
];
function participantColor(phone: string | null | undefined): string {
  if (!phone) return PARTICIPANT_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < phone.length; i++) hash = phone.charCodeAt(i) + ((hash << 5) - hash);
  return PARTICIPANT_PALETTE[Math.abs(hash) % PARTICIPANT_PALETTE.length];
}

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
        <Box sx={{ lineHeight: 1.55 }}>
          <RichMessageText text={message.body} textColor={textColor} />
        </Box>
      ) : null;
  }
}

// ── Main bubble ───────────────────────────────────────────────────────────────

/** Tipos com arquivo: só eles têm progresso de envio e reenvio (`POST /messages/:id/retry`). */
const MEDIA_TYPES: ReadonlySet<MessageType> = new Set(['image', 'video', 'audio', 'document', 'sticker']);

interface Props {
  message: ChatMessage;
  onReply?: (message: ChatMessage) => void;
  onParticipantClick?: (phone: string, name: string) => void;
  participantAvatars?: Record<string, string>;
  /** Reagir (`emoji`) ou remover a própria reação (`null`). Ausente → chips só leitura. */
  onSetReaction?: (message: ChatMessage, emoji: string | null) => void;
  /** Cancela o upload da bolha otimista. */
  onCancelUpload?: (message: ChatMessage) => void;
  /** Tentar de novo: retoma/reconfirma a bolha local ou reenvia a mídia gravada com falha. */
  onRetry?: (message: ChatMessage) => void;
  /** Descarta a bolha local com falha (mensagem gravada não é descartável). */
  onDiscard?: (message: ChatMessage) => void;
}

export function MessageBubble({
  message,
  onReply,
  onParticipantClick,
  participantAvatars,
  onSetReaction,
  onCancelUpload,
  onRetry,
  onDiscard,
}: Props) {
  const [hovered, setHovered] = useState(false);
  // Foco por teclado dentro da linha mostra as mesmas ações do hover.
  const [focused, setFocused] = useState(false);
  const [reactAnchor, setReactAnchor] = useState<HTMLElement | null>(null);
  const reactBtnRef = useRef<HTMLButtonElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const isOut = message.direction === 'out';

  const participantPhone = message.fromParticipant?.replace(/@.+$/, '') || null;

  // Mensagens antigas guardaram o LID no lugar do telefone (corrigido na ingestão,
  // mas o dado gravado permanece). Abrir conversa com um LID criaria um contato
  // inválido, então exigimos algo com cara de telefone: E.164 vai até 15 dígitos,
  // enquanto os LIDs observados têm 15 — daí o teto em 14.
  const canStartConversation = !!participantPhone && /^\d{10,14}$/.test(participantPhone);

  const handleOpenMenu = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
  };
  const handleCloseMenu = () => setMenuAnchor(null);

  const handleMenuReply = () => {
    handleCloseMenu();
    onReply?.(message);
  };

  const handleMenuReact = () => {
    handleCloseMenu();
    setReactAnchor(reactBtnRef.current);
  };

  const handleMenuCopy = () => {
    if (message.body) navigator.clipboard.writeText(message.body);
    handleCloseMenu();
  };

  const handleMenuChatWith = () => {
    handleCloseMenu();
    if (message.fromParticipant) {
      const phone = message.fromParticipant.replace(/@.+$/, '');
      onParticipantClick?.(phone, message.fromParticipantName ?? phone);
    }
  };

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

  // Apagada, nunca entregue, ainda enviando ou com falha: o contato pode não ter a mensagem
  // (a API responderia 409).
  const canReact =
    !!onSetReaction &&
    !message.isDeleted &&
    !!message.externalMessageId &&
    message.status !== 'sending' &&
    message.status !== 'failed';

  // Envio de mídia: `upload` só existe na bolha otimista; `sending` sem ele = PENDING do servidor.
  const isOutMedia = isOut && !message.isDeleted && MEDIA_TYPES.has(message.type);
  const upload = message.upload;
  const failure: FailedMessageKind | null =
    upload?.error ?? (isOutMedia && message.status === 'failed' && onRetry ? 'server' : null);
  const showProgress = isOutMedia && !failure && (!!upload || message.status === 'sending');
  const determinateProgress = upload?.phase === 'uploading' ? upload.progress : undefined;
  // Mensagem apagada não aceita resposta (o WhatsApp também não oferece): não há o que citar.
  // Em envio ou com falha também não: a mensagem ainda não existe no WhatsApp (e a bolha
  // otimista tem id `tmp-`, que a API não reconhece como citada).
  const canReply = !!onReply && !message.isDeleted
    && message.status !== 'sending' && message.status !== 'failed';
  const canCopy = !!message.body;
  const canChatWith = !isOut && canStartConversation && !!onParticipantClick;
  // Menu sem item nenhum (mídia em envio, apagada sem remetente) não ganha botão.
  const hasMenuItems = canReact || canReply || canCopy || canChatWith;
  const reactions = message.reactions ?? [];
  const hasReactions = reactions.some((r) => r.count > 0);
  const activeEmoji = reactions.find((r) => r.reactedByMe)?.emoji ?? null;
  const showActions = hovered || focused || Boolean(reactAnchor);

  const actionBtnSx = {
    opacity: showActions ? 1 : 0,
    transition: 'opacity 0.15s',
    pointerEvents: showActions ? 'auto' : 'none',
    width: 28,
    height: 28,
    color: 'text.secondary',
    flexShrink: 0,
    alignSelf: 'center',
    '&:hover': { color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.08) },
    '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
  } as const;

  const replyBtn = canReply && (
    <Tooltip title="Responder" placement={isOut ? 'left' : 'right'}>
      <IconButton
        size="small"
        aria-label="Responder mensagem"
        onClick={() => onReply?.(message)}
        sx={actionBtnSx}
      >
        <ReplyIcon sx={{ fontSize: 16, ...(isOut ? { transform: 'scaleX(-1)' } : {}) }} />
      </IconButton>
    </Tooltip>
  );

  const reactBtn = canReact && (
    <Tooltip title={chatStrings.reactions.react} placement={isOut ? 'left' : 'right'}>
      <IconButton
        ref={reactBtnRef}
        size="small"
        aria-label={chatStrings.reactions.reactToMessage}
        aria-haspopup="true"
        aria-expanded={Boolean(reactAnchor)}
        onClick={(e) => setReactAnchor(e.currentTarget)}
        sx={actionBtnSx}
      >
        <AddReactionOutlinedIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Tooltip>
  );

  const handleToggleChip = canReact
    ? (emoji: string, reactedByMe: boolean) => onSetReaction?.(message, reactedByMe ? null : emoji)
    : undefined;

  return (
    <>
    <Box
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      sx={{
        display: 'flex',
        justifyContent: isOut ? 'flex-end' : 'flex-start',
        // Alinhado ao topo: o avatar acompanha a linha do nome, como no WhatsApp Web,
        // em vez de flutuar na base de bolhas altas.
        alignItems: 'flex-start',
        gap: 0.25,
        px: 2.5,
        // Os chips sobrepõem a borda inferior: reserva espaço para não invadir a próxima bolha.
        mb: hasReactions ? 2 : 0.5,
      }}
    >
      {/* Reply btn à esquerda para mensagens enviadas */}
      {isOut && reactBtn}
      {isOut && replyBtn}
      {/* Avatar do remetente em mensagens de grupo recebidas, como no WhatsApp Web */}
      {!isOut && message.fromParticipantName && (
        <Avatar
          src={
            message.fromParticipantAvatarUrl
            ?? (participantPhone ? participantAvatars?.[participantPhone] : undefined)
            ?? undefined
          }
          sx={{
            width: 28,
            height: 28,
            fontSize: 11,
            fontWeight: 700,
            // Desce o suficiente para o centro do avatar cair na linha do nome.
            mt: 0.5,
            mr: 0.5,
            flexShrink: 0,
          }}
        >
          {(message.fromParticipantName[0] ?? '?').toUpperCase()}
        </Avatar>
      )}
      <Box
        sx={{
          position: 'relative',
          // No mobile a bolha pode ocupar mais da largura: 68% deixa linhas curtas
          // demais e obriga a quebrar frases simples.
          maxWidth: { xs: '85%', sm: '68%' },
          minWidth: 80,
          px: 1.5,
          pt: 1,
          pb: 0.75,
          // Canto agudo no topo, do lado de quem fala — a mesma aresta onde fica o
          // avatar — e não na base, como estava.
          borderRadius: isOut
            ? '16px 4px 16px 16px'
            : '4px 16px 16px 16px',
          bgcolor: bgColor,
          boxShadow: isDark ? 'none' : '0 1px 2px rgba(0,0,0,0.08)',
          // Bico do balão: triângulo saindo para fora, na altura da primeira linha,
          // formado por uma borda transparente contra a cor da bolha.
          '&::after': {
            content: '""',
            position: 'absolute',
            top: 0,
            ...(isOut
              ? { right: -7, borderWidth: '0 0 10px 8px' }
              : { left: -7, borderWidth: '0 8px 10px 0' }),
            width: 0,
            height: 0,
            borderStyle: 'solid',
            borderColor: isOut
              ? `transparent transparent transparent ${bgColor}`
              : `transparent ${bgColor} transparent transparent`,
          },
        }}
      >
        {/* Botão de menu contextual — aparece ao passar o mouse */}
        {hasMenuItems && (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              right: 0,
              borderRadius: isOut ? '0 16px 0 8px' : '0 16px 0 8px',
              background: `linear-gradient(135deg, transparent 30%, ${bgColor} 60%)`,
              opacity: showActions ? 1 : 0,
              transition: 'opacity 0.15s',
              pointerEvents: showActions ? 'auto' : 'none',
              zIndex: 1,
            }}
          >
            <IconButton
              size="small"
              aria-label="Opções da mensagem"
              onClick={handleOpenMenu}
              sx={{ p: 0.3, color: isOut ? alpha('#fff', 0.75) : 'text.secondary' }}
            >
              <KeyboardArrowDownIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Box>
        )}

        {/* Nome do remetente em mensagens de grupo recebidas */}
        {!isOut && message.fromParticipantName && (
          <Typography
            variant="caption"
            onClick={onParticipantClick
              ? () => {
                  const phone = (message.fromParticipant ?? '').replace(/@.+$/, '');
                  onParticipantClick(phone, message.fromParticipantName ?? phone);
                }
              : undefined
            }
            sx={{
              display: 'block',
              fontWeight: 700,
              fontSize: 11,
              color: participantColor(message.fromParticipant),
              mb: 0.25,
              cursor: onParticipantClick ? 'pointer' : 'default',
              '&:hover': onParticipantClick ? { textDecoration: 'underline' } : {},
            }}
          >
            {message.fromParticipantName}
            {participantPhone && (
              <Typography
                component="span"
                variant="caption"
                // O número ao lado do nome é contexto útil no desktop, mas rouba
                // largura preciosa no mobile, onde só o nome basta.
                sx={{ fontWeight: 400, fontSize: 10, ml: 0.75, opacity: 0.65, display: { xs: 'none', sm: 'inline' } }}
              >
                · {participantPhone.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '+55 $1 $2-$3')}
              </Typography>
            )}
          </Typography>
        )}

        {/* Mensagem citada (reply preview) */}
        {message.quotedMessage && (
          <QuotedMessage quoted={message.quotedMessage} isOut={isOut} />
        )}

        {/* Conteúdo da mensagem; mídia ganha um contêiner estável para o véu de envio */}
        {isOutMedia ? (
          // `isolation`: o véu não cobre o botão de opções da bolha (zIndex 1).
          <Box sx={{ position: 'relative', ...(showProgress && { minHeight: 56, isolation: 'isolate' }) }}>
            <MessageContent message={message} isOut={isOut} textColor={textColor} />
            {showProgress && (
              <UploadProgressOverlay
                progress={determinateProgress}
                onCancel={onCancelUpload ? () => onCancelUpload(message) : undefined}
              />
            )}
          </Box>
        ) : (
          <MessageContent message={message} isOut={isOut} textColor={textColor} />
        )}

        {failure && (
          <FailedMessageActions
            kind={failure}
            onRetry={onRetry ? () => onRetry(message) : undefined}
            onDiscard={onDiscard ? () => onDiscard(message) : undefined}
          />
        )}

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

        {/* Chips de reação: abaixo do horário (nunca por cima) e metade para fora da borda. */}
        {hasReactions && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: isOut ? 'flex-end' : 'flex-start',
              mt: 0.5,
              mb: '-18px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <MessageReactions reactions={reactions} onToggle={handleToggleChip} />
          </Box>
        )}
      </Box>

      {/* Reply btn à direita para mensagens recebidas */}
      {!isOut && replyBtn}
      {!isOut && reactBtn}
    </Box>

    {/* Menu de contexto da mensagem */}
    <Menu
      anchorEl={menuAnchor}
      open={Boolean(menuAnchor)}
      onClose={handleCloseMenu}
      anchorOrigin={{ vertical: 'bottom', horizontal: isOut ? 'right' : 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: isOut ? 'right' : 'left' }}
      slotProps={{ paper: { sx: { minWidth: 200, borderRadius: 2 } } }}
    >
      {canReact && (
        <MenuItem onClick={handleMenuReact} dense>
          <ListItemIcon><AddReactionOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{chatStrings.reactions.react}</ListItemText>
        </MenuItem>
      )}
      {canReply && (
        <MenuItem onClick={handleMenuReply} dense>
          <ListItemIcon><ReplyIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Responder</ListItemText>
        </MenuItem>
      )}
      {canCopy && (
        <MenuItem onClick={handleMenuCopy} dense>
          <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Copiar</ListItemText>
        </MenuItem>
      )}
      {canChatWith && (
        <MenuItem onClick={handleMenuChatWith} dense>
          <ListItemIcon><ChatIcon fontSize="small" /></ListItemIcon>
          <ListItemText
            primary={`Conversar com ${message.fromParticipantName ?? participantPhone}`}
            primaryTypographyProps={{ noWrap: true, sx: { maxWidth: 200 } }}
          />
        </MenuItem>
      )}
    </Menu>

    {canReact && (
      <ReactionBar
        anchorEl={reactAnchor}
        open={Boolean(reactAnchor)}
        onClose={() => setReactAnchor(null)}
        activeEmoji={activeEmoji}
        onSelect={(emoji) => onSetReaction?.(message, emoji)}
      />
    )}
    </>
  );
}
