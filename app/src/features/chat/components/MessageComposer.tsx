import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import {
  Box, TextField, IconButton, Tooltip, Divider, Popover, alpha, useTheme, Typography, CircularProgress,
  List, ListItemButton, ListItemAvatar, ListItemText, Avatar,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import EmojiEmotionsOutlinedIcon from '@mui/icons-material/EmojiEmotionsOutlined';
import MicNoneOutlinedIcon from '@mui/icons-material/MicNoneOutlined';
import CloseIcon from '@mui/icons-material/Close';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import AudiotrackOutlinedIcon from '@mui/icons-material/AudiotrackOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';
// Import direto (não pelo barrel `components/index.ts`) para a lib do picker seguir lazy.
import { EmojiPicker } from '@/components/EmojiPicker';
import type { QuotedMessagePreview } from '../types';
import { chatStrings } from '../strings';
import { pastedFiles } from '../media/dataTransferFiles';
import type { AttachmentOrigin } from '../media/mediaPolicy';
import { useVoiceRecorderContext } from '../media/VoiceRecorderProvider';
import { AttachmentMenu } from './AttachmentMenu';
import { VoiceRecorderBar } from './VoiceRecorderBar';
import { chatService } from '@/services/chat.service';
import type { GroupParticipantApiDto } from '@/types/chat.api.types';
import { extractMentionPhones } from '../mentions';

/** Escapa um nome para uso literal em RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * O campo mostra `@Nome` (como o WhatsApp Web); o texto enviado leva `@<telefone>`, que é o
 * formato que o WhatsApp e o painel resolvem de volta para o nome. `picks` guarda nome → telefone
 * dos participantes escolhidos no popover; nome editado à mão deixa de casar e segue como texto.
 */
function resolveMentionsForSend(text: string, picks: ReadonlyMap<string, string>): string {
  let resolved = text;
  for (const [name, phone] of picks) {
    const pattern = new RegExp(`(^|\\s)@${escapeRegExp(name)}(?=\\s|$)`, 'g');
    resolved = resolved.replace(pattern, `$1@${phone}`);
  }
  return resolved;
}

const texts = chatStrings.composer;
const voiceTexts = chatStrings.voice;
/** Alvo mínimo de clique/toque (MEDIA-23). */
const TOUCH_TARGET = 40;

const REPLY_TYPE_ICON: Record<string, React.ReactNode> = {
  image:    <ImageOutlinedIcon sx={{ fontSize: 13 }} />,
  audio:    <AudiotrackOutlinedIcon sx={{ fontSize: 13 }} />,
  document: <DescriptionOutlinedIcon sx={{ fontSize: 13 }} />,
  video:    <VideocamOutlinedIcon sx={{ fontSize: 13 }} />,
};
const REPLY_TYPE_LABEL: Readonly<Record<string, string>> = texts.replyTypes;

/** Acesso do pai ao texto do campo: a prévia do lote o usa como legenda do 1º item. */
export interface MessageComposerHandle {
  /** Texto atual, aparado. */
  getText: () => string;
  /** Limpa o campo (lote enviado). */
  clearText: () => void;
}

interface Props {
  /** `mentions`: telefones (dígitos) extraídos do texto final — presente só quando há `@<telefone>`. */
  onSend: (text: string, mentions?: string[]) => void;
  disabled?: boolean;
  replyTo?: QuotedMessagePreview | null;
  onCancelReply?: () => void;
  /** Arquivos do clipe (`media`/`document`) ou colados no campo (`auto`). Ausente → clipe desabilitado. */
  onAttachFiles?: (files: File[], origin: AttachmentOrigin) => void;
  /** Motivo do clipe desabilitado (tooltip). Com motivo, colar arquivo segue o padrão do navegador. */
  attachDisabledReason?: string | null;
  /**
   * A barra de voz passou a ocupar (ou deixou) a linha do campo — o pai bloqueia soltar arquivo
   * enquanto isso. Sem `VoiceRecorderProvider` acima, o microfone fica indisponível.
   */
  onVoiceBarChange?: (visible: boolean) => void;
  /** Conversa de grupo: liga o autocompletar de @menção. Sem isso, "@" é só texto. */
  isGroup?: boolean;
  /** Necessário para buscar participantes do grupo ao digitar "@". */
  conversationId?: string;
  ref?: Ref<MessageComposerHandle>;
}

export function MessageComposer({
  onSend,
  disabled,
  replyTo,
  onCancelReply,
  onAttachFiles,
  attachDisabledReason,
  onVoiceBarChange,
  isGroup,
  conversationId,
  ref,
}: Props) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const canAttach = !!onAttachFiles && !disabled && !attachDisabledReason;

  // ── Mensagem de voz ────────────────────────────────────────────────────────
  const voice = useVoiceRecorderContext();
  const barVisible = !!voice?.barVisible;
  const micDisabledReason = disabled
    ? voiceTexts.conversationClosed
    : !voice?.available
      ? voiceTexts.unavailable
      : null;
  const micBusy = !!voice?.requesting;
  const barStatus = barVisible ? voice?.state.status : undefined;
  const barRef = useRef<HTMLDivElement>(null);
  const barWasVisibleRef = useRef(barVisible);

  useEffect(() => {
    onVoiceBarChange?.(barVisible);
  }, [barVisible, onVoiceBarChange]);

  // Abriu gravando (só o microfone faz isso) → foco no enviar da barra; o rascunho que reabre
  // ao voltar à conversa não rouba o foco da lista. Fechou (enviou/descartou) com o foco nela
  // → volta ao campo.
  useEffect(() => {
    const wasVisible = barWasVisibleRef.current;
    barWasVisibleRef.current = barVisible;
    if (barVisible === wasVisible) return;
    if (barVisible) {
      if (barStatus === 'recording') {
        barRef.current?.querySelector<HTMLButtonElement>(`button[aria-label="${voiceTexts.send}"]`)?.focus();
      }
      return;
    }
    const focusLost = document.activeElement === null || document.activeElement === document.body;
    if (focusLost && !disabled) inputRef.current?.focus();
  }, [barVisible, barStatus, disabled]);

  const handleMicClick = () => {
    if (!voice || micDisabledReason || micBusy) return;
    void voice.start();
  };

  // Resposta ativa vai citada; enviado nesta conversa, o banner some (spec P1, critério 7).
  const handleVoiceSend = async () => {
    if (!voice || disabled) return;
    const sentHere = await voice.send(replyTo?.id ?? null);
    if (sentHere) onCancelReply?.();
  };

  useImperativeHandle(ref, () => ({ getText: () => text.trim(), clearText: () => setText('') }), [text]);

  // Responder leva o foco ao campo, como no WhatsApp. No quadro seguinte: fechar o menu da
  // bolha devolve o foco ao botão que o abriu, e isso roda no mesmo commit desta mudança.
  const replyToId = replyTo?.id ?? null;
  useEffect(() => {
    if (!replyToId || disabled) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [replyToId, disabled]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    const outgoing = resolveMentionsForSend(trimmed, mentionPicksRef.current);
    const mentions = extractMentionPhones(outgoing);
    if (mentions.length > 0) onSend(outgoing, mentions);
    else onSend(outgoing);
    setText('');
    mentionPicksRef.current.clear();
    inputRef.current?.focus();
  };

  // ── Emoji ──────────────────────────────────────────────────────────────────
  // O picker fica aberto após escolher (como no WhatsApp Web): o foco volta ao campo e o
  // Popover não o rouba de volta (`disableEnforceFocus`). Cursor pendente aplicado após o
  // React escrever o novo valor no campo — antes disso `setSelectionRange` cairia no valor velho.
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  const pendingCursorRef = useRef<number | null>(null);
  const emojiOpen = Boolean(emojiAnchor);
  const emojiDisabled = !!disabled || barVisible;

  useEffect(() => {
    if (emojiDisabled) setEmojiAnchor(null);
  }, [emojiDisabled]);

  useEffect(() => {
    if (disabled) closeMention();
  }, [disabled]);

  // Trocar de conversa não pode deixar o popover buscando participantes do chat anterior.
  useEffect(() => {
    closeMention();
    mentionPicksRef.current.clear();
  }, [conversationId]);

  useEffect(() => {
    const cursor = pendingCursorRef.current;
    const input = inputRef.current;
    if (cursor === null || !input) return;
    pendingCursorRef.current = null;
    input.focus();
    input.setSelectionRange(cursor, cursor);
  }, [text]);

  const closeEmoji = () => setEmojiAnchor(null);

  const insertEmoji = (emoji: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? start;
    setText(text.slice(0, start) + emoji + text.slice(end));
    pendingCursorRef.current = start + emoji.length;
  };

  // ── Menção (@) ─────────────────────────────────────────────────────────────
  // Só liga em grupo. O popover é conveniência de digitação; quem decide o que vira
  // menção de verdade é `extractMentionPhones` sobre o texto final, no envio — editar
  // ou apagar o "@<telefone>" depois de inserido também remove a menção, sem estado solto.
  const mentionTexts = chatStrings.mention;
  const mentionEnabled = !!isGroup && !!conversationId;
  const [mentionAnchor, setMentionAnchor] = useState<HTMLElement | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionResults, setMentionResults] = useState<GroupParticipantApiDto[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const mentionStartRef = useRef<number | null>(null);
  const mentionPicksRef = useRef(new Map<string, string>());
  const mentionOpen = Boolean(mentionAnchor);

  const closeMention = () => {
    setMentionAnchor(null);
    mentionStartRef.current = null;
    setMentionResults([]);
  };

  useEffect(() => {
    if (!mentionOpen || !conversationId) return;
    let cancelled = false;
    setMentionLoading(true);
    const timer = setTimeout(() => {
      chatService
        .listGroupParticipants(conversationId, mentionQuery ? { search: mentionQuery } : undefined)
        .then((res) => {
          if (cancelled) return;
          setMentionResults(res.participants.filter((p) => !!p.phone));
        })
        .catch(() => {
          if (!cancelled) setMentionResults([]);
        })
        .finally(() => {
          if (!cancelled) setMentionLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mentionOpen, mentionQuery, conversationId]);

  const insertMention = (participant: GroupParticipantApiDto) => {
    const start = mentionStartRef.current;
    if (start === null || !participant.phone) return;
    const input = inputRef.current;
    const cursor = input?.selectionStart ?? text.length;
    // Sem nome real (participante desconhecido tem o próprio número como nome) fica o telefone.
    const label = participant.name && !/^[\d\s+()-]+$/.test(participant.name)
      ? participant.name
      : participant.phone;
    if (label !== participant.phone) mentionPicksRef.current.set(label, participant.phone);
    const inserted = `@${label} `;
    setText(text.slice(0, start) + inserted + text.slice(cursor));
    pendingCursorRef.current = start + inserted.length;
    closeMention();
  };

  const handleTextChange = (value: string) => {
    setText(value);
    if (!mentionEnabled) return;
    const cursor = inputRef.current?.selectionStart ?? value.length;
    const uptoCursor = value.slice(0, cursor);
    const atIndex = uptoCursor.lastIndexOf('@');
    if (atIndex === -1 || /\s/.test(uptoCursor.slice(atIndex + 1))) {
      closeMention();
      return;
    }
    mentionStartRef.current = atIndex;
    setMentionQuery(uptoCursor.slice(atIndex + 1));
    setMentionAnchor(inputRef.current);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (mentionOpen && e.key === 'Enter' && mentionResults[0]) {
      e.preventDefault();
      insertMention(mentionResults[0]);
      return;
    }
    if (mentionOpen && e.key === 'Escape') {
      e.preventDefault();
      closeMention();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    // Com o foco no campo, o Esc não chega ao Popover; fecha o picker daqui.
    if (e.key === 'Escape' && emojiOpen) {
      e.preventDefault();
      closeEmoji();
    }
  };

  // Colar com arquivo (print, imagem copiada, arquivo do sistema) abre a prévia; só texto — ou
  // texto do Office, que vem com a imagem dele — segue normal.
  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (!canAttach || !onAttachFiles) return;
    const files = pastedFiles(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    onAttachFiles(files, 'auto');
  };

  const hasText = text.trim().length > 0;

  return (
    <Box>
      {/* ── Banner de resposta ─────────────────────────────────────────────── */}
      {replyTo && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1.5,
            pt: 1,
            pb: 0.25,
          }}
        >
          <Box
            sx={{
              flex: 1,
              borderLeft: '3px solid',
              borderColor: 'primary.main',
              pl: 1,
              py: 0.5,
              bgcolor: (t) => alpha(t.palette.primary.main, 0.07),
              borderRadius: '0 6px 6px 0',
              overflow: 'hidden',
              minWidth: 0,
            }}
          >
            {/* label do tipo (se não for texto) */}
            {replyTo.type !== 'text' && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, color: 'primary.main', mb: 0.1 }}>
                {REPLY_TYPE_ICON[replyTo.type] ?? null}
                <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600 }}>
                  {REPLY_TYPE_LABEL[replyTo.type] ?? replyTo.type}
                </Typography>
              </Box>
            )}
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                color: 'text.secondary',
                fontSize: 12,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {replyTo.isDeleted
                ? texts.replyDeleted
                : (replyTo.body ?? REPLY_TYPE_LABEL[replyTo.type] ?? '')}
            </Typography>
          </Box>
          <Tooltip title={texts.cancelReply}>
            <IconButton size="small" onClick={onCancelReply} sx={{ flexShrink: 0, color: 'text.secondary' }}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      <Divider />
      {/* Gravando ou com rascunho, a barra ocupa a linha: clipe e campo saem. `Esc` não
          descarta — perder a gravação por acidente custa mais que clicar na lixeira. */}
      {voice && barVisible ? (
        <Box ref={barRef}>
          <VoiceRecorderBar
            state={voice.state}
            levels={voice.levels}
            previewUrl={voice.previewUrl}
            onPause={voice.pause}
            onResume={voice.resume}
            onSend={() => void handleVoiceSend()}
            onDiscard={() => void voice.discard()}
            onPreviewError={voice.markPreviewFailed}
            sendDisabledReason={disabled ? voiceTexts.conversationClosed : null}
          />
        </Box>
      ) : (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 1,
            px: 1.5,
            py: 1.25,
            // Respeita a área segura de aparelhos com barra inferior (iPhone), para o
            // campo não ficar sob o indicador de home.
            pb: 'calc(10px + env(safe-area-inset-bottom))',
            bgcolor: 'background.paper',
          }}
        >
          {/* Emoji e anexos */}
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Tooltip title={texts.emoji} disableInteractive>
              <span>
                <IconButton
                  size="small"
                  aria-label={texts.emoji}
                  aria-haspopup="dialog"
                  aria-expanded={emojiOpen}
                  disabled={emojiDisabled}
                  onClick={(e) => setEmojiAnchor(emojiOpen ? null : e.currentTarget)}
                  sx={(t) => ({
                    color: emojiOpen ? t.palette.primary.main : t.palette.text.secondary,
                    '&.Mui-disabled': { color: t.palette.text.disabled },
                    '&.Mui-focusVisible': { outline: `2px solid ${t.palette.primary.main}`, outlineOffset: 2 },
                  })}
                >
                  <EmojiEmotionsOutlinedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Popover
              open={emojiOpen}
              anchorEl={emojiAnchor}
              onClose={closeEmoji}
              anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
              transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
              disableEnforceFocus
              slotProps={{
                paper: {
                  elevation: 6,
                  role: 'dialog',
                  'aria-label': texts.emoji,
                  sx: { borderRadius: 2, overflow: 'hidden', mb: 0.5 },
                },
              }}
            >
              <EmojiPicker onSelect={insertEmoji} onClose={closeEmoji} />
            </Popover>
            <AttachmentMenu
              onFiles={(files, origin) => onAttachFiles?.(files, origin)}
              disabled={!canAttach}
              disabledReason={attachDisabledReason ?? undefined}
            />
          </Box>

          {/* Input */}
          <TextField
            inputRef={inputRef}
            multiline
            maxRows={4}
            fullWidth
            size="small"
            placeholder={texts.placeholder}
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={disabled}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 3,
                fontSize: 14,
                bgcolor: alpha(theme.palette.text.primary, 0.04),
                '& fieldset': { border: 'none' },
                '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.06) },
                '&.Mui-focused': {
                  bgcolor: alpha(theme.palette.primary.main, 0.04),
                  outline: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
                },
              },
            }}
          />
          <Popover
            open={mentionOpen}
            anchorEl={mentionAnchor}
            onClose={closeMention}
            anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            disableAutoFocus
            disableEnforceFocus
            slotProps={{
              paper: {
                elevation: 6,
                role: 'listbox',
                'aria-label': mentionTexts.ariaLabel,
                sx: { borderRadius: 2, overflow: 'hidden', mb: 0.5, width: 260, maxHeight: 280 },
              },
            }}
          >
            {mentionLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={18} />
              </Box>
            ) : mentionResults.length === 0 ? (
              <Typography variant="caption" sx={{ display: 'block', p: 2, color: 'text.secondary' }}>
                {mentionTexts.noResults}
              </Typography>
            ) : (
              <List dense disablePadding>
                {mentionResults.map((p) => (
                  <ListItemButton key={p.phone} onMouseDown={(e) => e.preventDefault()} onClick={() => insertMention(p)}>
                    <ListItemAvatar sx={{ minWidth: 36 }}>
                      <Avatar src={p.avatarUrl ?? undefined} sx={{ width: 28, height: 28, fontSize: 12 }}>
                        {p.initials}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={p.name}
                      secondary={p.phone}
                      slotProps={{
                        primary: { fontSize: 13, noWrap: true },
                        secondary: { fontSize: 11 },
                      }}
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Popover>

          {/* Enviar ou microfone. Recuo só no enviar (36 px): o microfone tem os 40 px do clipe. */}
          <Box sx={{ pb: hasText ? 0.5 : 0 }}>
            {hasText ? (
              <Tooltip title={texts.send}>
                <IconButton
                  onClick={handleSend}
                  disabled={disabled}
                  sx={{
                    bgcolor: 'primary.main',
                    color: '#fff',
                    width: 36,
                    height: 36,
                    '&:hover': { bgcolor: 'primary.dark' },
                    '&:disabled': { bgcolor: 'action.disabledBackground' },
                    transition: 'all 0.15s',
                  }}
                >
                  <SendIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            ) : (
              <Tooltip
                title={micDisabledReason ?? texts.recordVoice}
                describeChild={!!micDisabledReason}
                disableInteractive
              >
                {/* `aria-disabled` em vez de `disabled`: segue focável e o motivo chega ao teclado. */}
                <IconButton
                  aria-label={texts.recordVoice}
                  aria-disabled={!!micDisabledReason || undefined}
                  aria-busy={micBusy || undefined}
                  disableRipple={!!micDisabledReason}
                  onClick={handleMicClick}
                  sx={(t) => ({
                    width: TOUCH_TARGET,
                    height: TOUCH_TARGET,
                    color: micDisabledReason ? t.palette.text.disabled : t.palette.text.secondary,
                    cursor: micDisabledReason ? 'default' : 'pointer',
                    '&:hover': { bgcolor: micDisabledReason ? 'transparent' : t.palette.action.hover },
                    '&.Mui-focusVisible': { outline: `2px solid ${t.palette.primary.main}`, outlineOffset: 2 },
                  })}
                >
                  {micBusy ? (
                    <CircularProgress size={18} color="inherit" aria-hidden="true" />
                  ) : (
                    <MicNoneOutlinedIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
