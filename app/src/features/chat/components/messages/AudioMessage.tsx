import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography, alpha, useTheme } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import AudiotrackIcon from '@mui/icons-material/Audiotrack';

interface Props {
  mediaUrl?: string | null;
  mimeType?: string | null;
  durationSeconds?: number | null;
  isOut: boolean;
}

function formatDuration(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function AudioMessage({ mediaUrl, mimeType, durationSeconds }: Props) {
  const theme = useTheme();
  const isPtt = mimeType?.includes('ogg') || mimeType?.includes('opus') || mimeType?.includes('mpeg');
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

  // ── sem mídia: placeholder ─────────────────────────────────────────────────
  if (!resolvedMediaUrl || error) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          p: 1.25,
          bgcolor: alpha(theme.palette.text.primary, 0.07),
          borderRadius: 1.5,
          minWidth: 160,
        }}
      >
        {isPtt
          ? <MicIcon sx={{ fontSize: 22, color: 'text.secondary' }} />
          : <AudiotrackIcon sx={{ fontSize: 22, color: 'text.secondary' }} />}
        <Box>
          <Typography variant="caption" display="block" color="text.secondary">
            {isPtt ? 'Mensagem de voz' : 'Áudio'}
          </Typography>
          {durationSeconds ? (
            <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled' }}>
              {formatDuration(durationSeconds)}
            </Typography>
          ) : null}
        </Box>
      </Box>
    );
  }

  // ── player nativo: entrega Baixar, Velocidade de reprodução e ⋮ de graça ──
  return (
    <Box
      key={resolvedMediaUrl}
      component="audio"
      controls
      src={resolvedMediaUrl}
      onError={handleError}
      preload="metadata"
      sx={{
        display: 'block',
        width: '100%',
        minWidth: 280,
        maxWidth: 340,
        // Sem height fixo — o browser decide; Chrome usa ~54px com todos os controles visíveis
        outline: 'none',
        borderRadius: 1,
      }}
    />
  );
}
