import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, CircularProgress, IconButton, Tooltip, Typography, alpha, type SxProps, type Theme } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PauseIcon from '@mui/icons-material/Pause';
import MicIcon from '@mui/icons-material/Mic';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import type { VoiceRecorderState, VoiceRecorderStatus } from '../media/voiceRecorderMachine';
import { chatStrings } from '../strings';

const texts = chatStrings.voice;

/** Estados em que a barra substitui a linha do composer; nos demais não renderiza. */
const BAR_STATUSES: ReadonlySet<VoiceRecorderStatus> = new Set(['recording', 'paused', 'draft', 'sending']);
/** O hook guarda as últimas 48 barras (design §14); cortar aqui protege o layout. */
const MAX_BARS = 48;
/** Alvo mínimo de toque/clique (MEDIA-23). */
const TARGET = 40;
const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

export interface VoiceRecorderBarProps {
  state: VoiceRecorderState;
  /** Níveis 0–1 das ondas, do mais antigo ao mais novo. */
  levels: number[];
  /** URL do trecho gravado para a pré-escuta; `null` enquanto não há. */
  previewUrl: string | null;
  onPause: () => void;
  onResume: () => void;
  onSend: () => void;
  onDiscard: () => void;
  /** O navegador não tocou o trecho (`context.md` D2): o hook marca a pré-escuta indisponível. */
  onPreviewError: () => void;
}

/** 65 → `01:05`. */
function formatTimer(totalSeconds: number): string {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/** Nível → altura da barra em %; silêncio vira um traço curto. */
function barHeight(level: number): number {
  const safe = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  return Math.round(15 + safe * 85);
}

/** `AbortError` = o trecho foi trocado durante o carregamento, não incompatibilidade. */
const isAbort = (err: unknown) => (err as { name?: unknown } | null)?.name === 'AbortError';

interface BarActionProps {
  label: string;
  /** Texto do tooltip quando difere do rótulo (ex.: motivo de estar desabilitado). */
  tooltip?: string;
  disabled?: boolean;
  onClick: () => void;
  sx?: SxProps<Theme>;
  children: ReactNode;
}

function BarAction({ label, tooltip, disabled, onClick, sx, children }: BarActionProps) {
  return (
    <Tooltip title={tooltip ?? label}>
      {/* `span` fixo: botão desabilitado não recebe eventos e o tooltip precisa deles. */}
      <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}>
        <IconButton
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          sx={[{ width: TARGET, height: TARGET }, ...(Array.isArray(sx) ? sx : [sx])]}
        >
          {children}
        </IconButton>
      </Box>
    </Tooltip>
  );
}

function RecordingDot() {
  return (
    <Box
      role="img"
      aria-label={texts.recording}
      sx={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        bgcolor: 'error.main',
        animation: 'voiceRecordingPulse 1.4s ease-in-out infinite',
        '@keyframes voiceRecordingPulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.3 } },
        [REDUCED_MOTION]: { animation: 'none' },
      }}
    />
  );
}

interface PreviewToggleProps {
  url: string | null;
  unsupported: boolean;
  onError: () => void;
}

/** Tocar/parar o trecho gravado. Montado por URL (`key`): trocar o trecho zera o estado. */
function PreviewToggle({ url, unsupported, onError }: PreviewToggleProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const isPlaying = playing && !unsupported;

  // Sair da pré-escuta (retomar, enviar, descartar) cala o trecho.
  useEffect(() => {
    const audio = audioRef.current;
    return () => audio?.pause();
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      audio.currentTime = 0;
      setPlaying(false);
      return;
    }
    setPlaying(true);
    audio.play().catch((err: unknown) => {
      setPlaying(false);
      if (!isAbort(err)) onError();
    });
  };

  return (
    <>
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={onError}
        />
      )}
      <BarAction
        label={isPlaying ? texts.stopPlaying : texts.play}
        tooltip={unsupported ? texts.previewUnsupported : undefined}
        disabled={unsupported || !url}
        onClick={toggle}
        sx={{ color: 'primary.main' }}
      >
        {isPlaying ? <StopIcon /> : <PlayArrowIcon />}
      </BarAction>
    </>
  );
}

function Waves({ levels, live }: { levels: number[]; live: boolean }) {
  return (
    <Box
      data-testid="voice-recorder-waves"
      aria-hidden="true"
      sx={{
        flex: 1,
        minWidth: 0,
        height: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '2px',
        overflow: 'hidden',
        // Estilo no pai e altura inline: a altura muda a cada quadro e não deve gerar classe nova.
        '& > span': {
          width: 3,
          flexShrink: 0,
          borderRadius: '2px',
          bgcolor: live ? 'text.secondary' : 'text.disabled',
          transition: 'height 90ms linear',
          [REDUCED_MOTION]: { transition: 'none' },
        },
      }}
    >
      {levels.slice(-MAX_BARS).map((level, index) => (
        <span key={index} style={{ height: `${barHeight(level)}%` }} />
      ))}
    </Box>
  );
}

/**
 * Barra de gravação de voz (design §14, "Gravador"; spec P1 Voz e P2 Pausar). Só apresentação:
 * o estado vem do redutor e as ações sobem por callback. Ocupa a linha do composer (mesma altura
 * e espaçamento) — o divisor e o banner de resposta acima ficam com quem a renderiza.
 */
export function VoiceRecorderBar({
  state,
  levels,
  previewUrl,
  onPause,
  onResume,
  onSend,
  onDiscard,
  onPreviewError,
}: VoiceRecorderBarProps) {
  const { status } = state;
  if (!BAR_STATUSES.has(status)) return null;

  const recording = status === 'recording';
  const paused = status === 'paused';
  const draft = status === 'draft';
  const sending = status === 'sending';
  const seconds = Math.floor(state.elapsedMs / 1000);
  // No máximo o hook pausa sozinho: o tempo gravado é o próprio limite.
  const limitMinutes = Math.max(1, Math.round(state.elapsedMs / 60_000));

  return (
    <Box
      role="group"
      aria-label={draft ? texts.draft : texts.record}
      aria-busy={sending || undefined}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 1.25,
        // Mesma área segura do composer (iPhone).
        pb: 'calc(10px + env(safe-area-inset-bottom))',
        bgcolor: 'background.paper',
      }}
    >
      <BarAction
        label={texts.discard}
        disabled={sending}
        onClick={onDiscard}
        sx={{
          color: 'text.secondary',
          '&:hover': { color: 'error.main', bgcolor: (t) => alpha(t.palette.error.main, 0.08) },
        }}
      >
        <DeleteOutlineIcon fontSize="small" />
      </BarAction>

      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          height: TARGET,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pr: 1.5,
          borderRadius: 3,
          bgcolor: (t) => alpha(t.palette.text.primary, 0.04),
        }}
      >
        <Box sx={{ width: TARGET, height: TARGET, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
          {recording && <RecordingDot />}
          {(paused || draft) && (
            <PreviewToggle
              key={previewUrl ?? ''}
              url={previewUrl}
              unsupported={state.previewUnsupported}
              onError={onPreviewError}
            />
          )}
          {sending && <CircularProgress size={18} aria-label={chatStrings.upload.sending} />}
        </Box>

        {draft && (
          <Typography variant="caption" noWrap sx={{ color: 'text.secondary', fontWeight: 500, flexShrink: 0 }}>
            {texts.draft}
          </Typography>
        )}

        <Waves levels={levels} live={recording} />

        <Typography
          component="span"
          // `timer` não anuncia a cada segundo (um `status` polite falaria o tempo sem parar);
          // o rótulo falado fica disponível quando o foco ou o leitor chega nele.
          role="timer"
          aria-label={texts.timerLabel(seconds)}
          sx={{ fontSize: 14, fontVariantNumeric: 'tabular-nums', color: 'text.primary', flexShrink: 0 }}
        >
          {formatTimer(seconds)}
        </Typography>
      </Box>

      {(recording || paused) && (
        <BarAction
          label={recording ? texts.pause : texts.resume}
          tooltip={paused && state.maxReached ? texts.maxReached(limitMinutes) : undefined}
          disabled={paused && state.maxReached}
          onClick={recording ? onPause : onResume}
          sx={{ color: 'error.main' }}
        >
          {recording ? <PauseIcon /> : <MicIcon />}
        </BarAction>
      )}

      <BarAction
        label={texts.send}
        disabled={sending}
        onClick={onSend}
        sx={{
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          '&:hover': { bgcolor: 'primary.dark' },
          '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'action.disabled' },
        }}
      >
        <SendIcon sx={{ fontSize: 18 }} />
      </BarAction>
    </Box>
  );
}
