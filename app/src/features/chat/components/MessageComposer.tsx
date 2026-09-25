import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { Box, TextField, IconButton, Tooltip, Divider, alpha, useTheme, Typography, CircularProgress } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import EmojiEmotionsOutlinedIcon from '@mui/icons-material/EmojiEmotionsOutlined';
import MicNoneOutlinedIcon from '@mui/icons-material/MicNoneOutlined';
import CloseIcon from '@mui/icons-material/Close';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import AudiotrackOutlinedIcon from '@mui/icons-material/AudiotrackOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';
import type { QuotedMessagePreview } from '../types';
import { chatStrings } from '../strings';
import { filesFrom } from '../media/dataTransferFiles';
import type { AttachmentOrigin } from '../media/mediaPolicy';
import { useVoiceRecorderContext } from '../media/VoiceRecorderProvider';
import { AttachmentMenu } from './AttachmentMenu';
import { VoiceRecorderBar } from './VoiceRecorderBar';

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
  onSend: (text: string) => void;
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
    if (!voice) return;
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
    onSend(trimmed);
    setText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Colar com arquivo (print, imagem copiada, arquivo do sistema) abre a prévia; só texto segue normal.
  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (!canAttach || !onAttachFiles) return;
    const files = filesFrom(e.clipboardData);
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
            <Tooltip title={texts.emojiSoon}>
              <span>
                <IconButton size="small" disabled sx={{ color: 'text.disabled' }}>
                  <EmojiEmotionsOutlinedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
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
            onChange={(e) => setText(e.target.value)}
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
