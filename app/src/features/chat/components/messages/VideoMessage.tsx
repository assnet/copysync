import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography, alpha, useTheme } from '@mui/material';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';
import BrokenImageOutlinedIcon from '@mui/icons-material/BrokenImageOutlined';
import { RichMessageText } from './RichMessageText';

interface Props {
  mediaUrl?: string | null;
  mimeType?: string | null;
  durationSeconds?: number | null;
  body?: string | null;
  textColor: string;
}

function formatDuration(sec: number | null | undefined): string {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Altura aproximada da barra de controles nativa, reservada para os cliques dela. */
const CONTROLS_HEIGHT = 40;

export function VideoMessage({ mediaUrl, durationSeconds, body, textColor }: Props) {
  const theme = useTheme();
  const [error, setError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const retriedRef = useRef(false);

  useEffect(() => {
    setError(false);
    setRetryNonce(0);
    retriedRef.current = false;
  }, [mediaUrl]);

  const resolvedMediaUrl = useMemo(() => {
    if (!mediaUrl) return null;
    if (retryNonce === 0) return mediaUrl;
    const separator = mediaUrl.includes('?') ? '&' : '?';
    return `${mediaUrl}${separator}retry=${retryNonce}`;
  }, [mediaUrl, retryNonce]);

  const handleError = () => {
    if (!retriedRef.current) {
      retriedRef.current = true;
      window.setTimeout(() => setRetryNonce((current) => current + 1), 700);
      return;
    }
    setError(true);
  };

  if (!resolvedMediaUrl) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          p: 1.5,
          mb: body ? 1 : 0,
          bgcolor: alpha(theme.palette.text.primary, 0.06),
          borderRadius: 1.5,
          color: 'text.secondary',
        }}
      >
        <VideocamOutlinedIcon sx={{ fontSize: 24 }} />
        <Box>
          <Typography variant="caption" display="block">Vídeo</Typography>
          {durationSeconds && (
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>
              {formatDuration(durationSeconds)}
            </Typography>
          )}
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          p: 1.5,
          mb: body ? 1 : 0,
          bgcolor: alpha(theme.palette.text.primary, 0.06),
          borderRadius: 1.5,
          color: 'text.secondary',
        }}
      >
        <BrokenImageOutlinedIcon sx={{ fontSize: 24 }} />
        <Typography variant="caption">Vídeo não disponível</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box
        key={resolvedMediaUrl}
        component="video"
        controls
        // metadata traz duração e primeiro quadro sem baixar o vídeo inteiro: sem
        // isso o primeiro clique era gasto carregando, e só o segundo reproduzia.
        preload="metadata"
        playsInline
        src={resolvedMediaUrl}
        onError={handleError}
        onClick={(e: React.MouseEvent<HTMLVideoElement>) => {
          const video = e.currentTarget;
          // A barra de controles nativa ocupa a faixa inferior; cliques ali são dela.
          const y = e.clientY - video.getBoundingClientRect().top;
          if (y > video.clientHeight - CONTROLS_HEIGHT) return;

          if (video.paused) void video.play().catch(() => {});
          else video.pause();
        }}
        sx={{
          cursor: 'pointer',
          width: '100%',
          maxWidth: '100%',
          maxHeight: 220,
          borderRadius: 1.5,
          display: 'block',
        }}
      />
      {body && (
        <RichMessageText text={body} textColor={textColor} />
      )}
    </Box>
  );
}
