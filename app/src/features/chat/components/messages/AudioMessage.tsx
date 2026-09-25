import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Avatar, Box, ButtonBase, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import AudiotrackIcon from '@mui/icons-material/Audiotrack';
import PersonIcon from '@mui/icons-material/Person';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import { chatStrings } from '../../strings';
import { WAVEFORM_BARS, getCachedWaveform, loadWaveform, pseudoWaveform } from '../../media/audioWaveform';
import { claimActiveAudio, releaseActiveAudio } from '../../media/activeAudio';

interface Props {
  mediaUrl?: string | null;
  mimeType?: string | null;
  durationSeconds?: number | null;
  isOut: boolean;
  /** Foto de quem enviou. Sem ela, o avatar fica genérico — o lugar é reservado sempre. */
  avatarUrl?: string | null;
  /** Semente da onda provisória (id da mensagem); sem ela vale a URL. */
  waveformSeed?: string;
}

const t = chatStrings.audioPlayer;

/** Velocidades na ordem em que o clique na duração alterna. */
const PLAYBACK_RATES = [1, 1.5, 2] as const;
/** Setas do teclado deslocam este tanto. */
const SEEK_STEP_SECONDS = 5;

const AVATAR_SIZE = 40;
const PLAY_SIZE = 34;
const WAVE_HEIGHT = 26;
const MIN_BAR_HEIGHT = 3;
const CURSOR_SIZE = 12;

export function formatDuration(sec: number): string {
  if (!sec || !isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "1×", "1,5×", "2×" — vírgula decimal como o resto do painel. */
export function formatRate(rate: number): string {
  return `${String(rate).replace('.', ',')}×`;
}

/** Nota de voz pelo formato: Ogg/Opus é o da engine; WebM e MP4 vêm do gravador do painel. */
function isVoiceNote(mimeType?: string | null): boolean {
  const mime = (mimeType ?? '').toLowerCase();
  return mime.includes('ogg') || mime.includes('opus') || mime.includes('webm') || mime.includes('mp4');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function AudioMessage({ mediaUrl, mimeType, durationSeconds, isOut, avatarUrl, waveformSeed }: Props) {
  const theme = useTheme();
  const isPtt = isVoiceNote(mimeType);

  const audioRef = useRef<HTMLAudioElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const retriedRef = useRef(false);
  const waveformRequestedRef = useRef(false);
  const waveformAbortRef = useRef<AbortController | null>(null);

  const [error, setError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [rateIndex, setRateIndex] = useState(0);
  const [waveform, setWaveform] = useState<number[]>(() =>
    (mediaUrl ? getCachedWaveform(mediaUrl) : undefined)
      ?? pseudoWaveform(waveformSeed ?? mediaUrl ?? 'audio', WAVEFORM_BARS),
  );

  const rate = PLAYBACK_RATES[rateIndex];

  // Troca de arquivo (nova URL ou prévia otimista virando definitiva) zera o player.
  useEffect(() => {
    setError(false);
    setRetryNonce(0);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(durationSeconds ?? 0);
    retriedRef.current = false;
    waveformRequestedRef.current = false;
    waveformAbortRef.current?.abort();
    waveformAbortRef.current = null;
    setWaveform(
      (mediaUrl ? getCachedWaveform(mediaUrl) : undefined)
        ?? pseudoWaveform(waveformSeed ?? mediaUrl ?? 'audio', WAVEFORM_BARS),
    );
  }, [mediaUrl, durationSeconds, waveformSeed]);

  const resolvedMediaUrl = useMemo(() => {
    if (!mediaUrl) return null;
    if (retryNonce === 0) return mediaUrl;
    const separator = mediaUrl.includes('?') ? '&' : '?';
    return `${mediaUrl}${separator}retry=${retryNonce}`;
  }, [mediaUrl, retryNonce]);

  // A onda real só é pedida quando vale a pena: bolha visível ou play. Nunca bloqueia o play.
  const requestWaveform = useCallback(() => {
    if (!mediaUrl || waveformRequestedRef.current) return;
    waveformRequestedRef.current = true;
    const controller = new AbortController();
    waveformAbortRef.current = controller;
    loadWaveform(mediaUrl, WAVEFORM_BARS, controller.signal)
      .then((bars) => { if (!controller.signal.aborted) setWaveform(bars); })
      .catch(() => undefined);
  }, [mediaUrl]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !mediaUrl || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        requestWaveform();
        observer.disconnect();
      }
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [mediaUrl, requestWaveform]);

  useEffect(() => () => {
    waveformAbortRef.current?.abort();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      releaseActiveAudio(audio);
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = rate;
  }, [rate, resolvedMediaUrl]);

  const handleError = () => {
    if (!retriedRef.current) {
      retriedRef.current = true;
      window.setTimeout(() => setRetryNonce((current) => current + 1), 700);
      return;
    }
    setPlaying(false);
    setError(true);
  };

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (audio && isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
  };

  const handleTimeUpdate = () => {
    if (draggingRef.current) return;
    const audio = audioRef.current;
    if (audio) setCurrentTime(audio.currentTime);
  };

  const handleEnded = () => {
    setPlaying(false);
    setCurrentTime(0);
    const audio = audioRef.current;
    if (audio) audio.currentTime = 0;
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    claimActiveAudio(audio);
    requestWaveform();
    audio.playbackRate = rate;
    const result = audio.play() as Promise<void> | undefined;
    // A rejeição vem de pausa imediata ou de autoplay bloqueado; o `error` do elemento
    // cuida de arquivo quebrado.
    if (result && typeof result.catch === 'function') result.catch(() => undefined);
  };

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current;
    const total = duration || audio?.duration || 0;
    const target = clamp(seconds, 0, total);
    if (audio) audio.currentTime = target;
    setCurrentTime(target);
  }, [duration]);

  const seekFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = sliderRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    seekTo(ratio * duration);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    event.preventDefault();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekFromPointer(event);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) seekFromPointer(event);
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const handleSliderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let target: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        target = currentTime + SEEK_STEP_SECONDS;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        target = currentTime - SEEK_STEP_SECONDS;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = duration;
        break;
      case ' ':
      case 'Enter':
        event.preventDefault();
        togglePlay();
        return;
      default:
        return;
    }
    event.preventDefault();
    seekTo(target);
  };

  const cycleRate = () => setRateIndex((index) => (index + 1) % PLAYBACK_RATES.length);

  // ── paleta: mesma da bolha (saída usa o contraste do primário, entrada usa o texto) ──
  const fg = isOut ? theme.palette.primary.contrastText : theme.palette.text.primary;
  const playedColor = isOut ? fg : theme.palette.primary.main;
  const idleColor = alpha(fg, isOut ? 0.45 : 0.26);
  const playBg = alpha(fg, isOut ? 0.18 : 0.08);
  const timeColor = isOut ? alpha(fg, 0.85) : theme.palette.text.secondary;
  const focusRing = isOut ? fg : theme.palette.primary.main;

  const unavailable = !resolvedMediaUrl || error;
  const progress = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
  const showCurrent = playing || currentTime > 0;
  const shownTime = showCurrent ? currentTime : duration;
  const rateLabel = formatRate(rate);

  const avatar = (
    <Box sx={{ position: 'relative', flexShrink: 0, width: AVATAR_SIZE, height: AVATAR_SIZE }}>
      <Avatar
        src={avatarUrl ?? undefined}
        alt={avatarUrl ? t.senderAvatar : undefined}
        sx={{
          width: AVATAR_SIZE,
          height: AVATAR_SIZE,
          bgcolor: alpha(fg, isOut ? 0.22 : 0.12),
          color: alpha(fg, 0.7),
        }}
      >
        {isPtt ? <PersonIcon sx={{ fontSize: 26 }} /> : <AudiotrackIcon sx={{ fontSize: 22 }} />}
      </Avatar>
      {isPtt && (
        <Box
          component="span"
          role="img"
          aria-label={t.voiceNote}
          sx={{
            position: 'absolute',
            right: -3,
            bottom: -2,
            width: 18,
            height: 18,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: isOut ? fg : theme.palette.primary.main,
            color: isOut ? theme.palette.primary.main : theme.palette.primary.contrastText,
            boxShadow: `0 0 0 2px ${isOut ? theme.palette.primary.main : theme.palette.background.paper}`,
          }}
        >
          <MicIcon sx={{ fontSize: 12 }} />
        </Box>
      )}
    </Box>
  );

  // ── sem mídia ou erro: placeholder com o play desligado ───────────────────────
  if (unavailable) {
    const label = error ? t.unavailable : (isPtt ? t.voiceNote : t.audio);
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minWidth: 220,
          maxWidth: 320,
          height: 56,
          px: 0.5,
        }}
      >
        {avatar}
        <IconButton
          disabled
          aria-label={t.play}
          sx={{ width: PLAY_SIZE, height: PLAY_SIZE, bgcolor: playBg, '&.Mui-disabled': { color: alpha(fg, 0.35) } }}
        >
          <PlayArrowRoundedIcon />
        </IconButton>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="caption" display="block" sx={{ color: alpha(fg, 0.75), lineHeight: 1.3 }} noWrap>
            {label}
          </Typography>
          {durationSeconds ? (
            <Typography variant="caption" sx={{ fontSize: 11, color: timeColor, fontVariantNumeric: 'tabular-nums' }}>
              {formatDuration(durationSeconds)}
            </Typography>
          ) : null}
        </Box>
      </Box>
    );
  }

  // ── player ─────────────────────────────────────────────────────────────────
  return (
    <Box
      ref={rootRef}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        width: { xs: 'min(300px, 100%)', sm: 300 },
        maxWidth: '100%',
        height: 56,
        px: 0.5,
      }}
    >
      <audio
        key={resolvedMediaUrl}
        ref={audioRef}
        src={resolvedMediaUrl}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleLoadedMetadata}
        onError={handleError}
        style={{ display: 'none' }}
      />

      {avatar}

      <IconButton
        onClick={togglePlay}
        aria-label={playing ? t.pause : t.play}
        sx={{
          width: PLAY_SIZE,
          height: PLAY_SIZE,
          flexShrink: 0,
          color: fg,
          bgcolor: playBg,
          '&:hover': { bgcolor: alpha(fg, isOut ? 0.28 : 0.14) },
          '&:focus-visible': { outline: `2px solid ${focusRing}`, outlineOffset: 2 },
        }}
      >
        {playing ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
      </IconButton>

      <Box
        ref={sliderRef}
        role="slider"
        tabIndex={0}
        aria-label={t.seek}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={t.position(currentTime, duration)}
        aria-orientation="horizontal"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleSliderKeyDown}
        sx={{
          position: 'relative',
          flex: 1,
          minWidth: 120,
          height: WAVE_HEIGHT + 12,
          display: 'flex',
          alignItems: 'center',
          gap: '1.5px',
          cursor: 'pointer',
          touchAction: 'none',
          borderRadius: 1,
          outline: 'none',
          '&:focus-visible': { outline: `2px solid ${focusRing}`, outlineOffset: 2 },
        }}
      >
        {waveform.map((value, index) => {
          const played = index / waveform.length < progress || (progress >= 1 && index === waveform.length - 1);
          return (
            <Box
              key={index}
              aria-hidden
              sx={{
                flex: '1 0 2px',
                minWidth: 2,
                height: Math.max(MIN_BAR_HEIGHT, Math.round(value * WAVE_HEIGHT)),
                borderRadius: 2,
                bgcolor: played ? playedColor : idleColor,
                '@media (prefers-reduced-motion: no-preference)': { transition: 'background-color 120ms linear' },
              }}
            />
          );
        })}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: '50%',
            left: `${progress * 100}%`,
            width: CURSOR_SIZE,
            height: CURSOR_SIZE,
            borderRadius: '50%',
            bgcolor: playedColor,
            transform: 'translate(-50%, -50%)',
            boxShadow: `0 1px 3px ${alpha('#000', 0.25)}`,
            pointerEvents: 'none',
            '@media (prefers-reduced-motion: no-preference)': { transition: 'left 80ms linear' },
          }}
        />
      </Box>

      <Tooltip title={t.speed(rateLabel)} placement="top" enterDelay={400}>
        <ButtonBase
          onClick={cycleRate}
          aria-label={t.speed(rateLabel)}
          focusRipple
          sx={{
            flexShrink: 0,
            minWidth: 36,
            height: 22,
            px: 0.5,
            borderRadius: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            justifyContent: 'center',
            color: timeColor,
            '&:focus-visible': { outline: `2px solid ${focusRing}`, outlineOffset: 2 },
          }}
        >
          <Typography
            component="span"
            variant="caption"
            sx={{ fontSize: 11.5, lineHeight: 1, fontVariantNumeric: 'tabular-nums', fontWeight: rate !== 1 ? 700 : 400 }}
          >
            {rate !== 1 ? rateLabel : formatDuration(shownTime)}
          </Typography>
          {rate !== 1 && (
            <Typography component="span" variant="caption" sx={{ fontSize: 9.5, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
              {formatDuration(shownTime)}
            </Typography>
          )}
        </ButtonBase>
      </Tooltip>
    </Box>
  );
}
