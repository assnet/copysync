import { useState } from 'react';
import { Box, Typography, alpha, useTheme } from '@mui/material';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';
import BrokenImageOutlinedIcon from '@mui/icons-material/BrokenImageOutlined';

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

export function VideoMessage({ mediaUrl, durationSeconds, body, textColor }: Props) {
  const theme = useTheme();
  const [error, setError] = useState(false);

  if (!mediaUrl) {
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
        component="video"
        controls
        src={mediaUrl}
        onError={() => setError(true)}
        sx={{
          width: '100%',
          maxWidth: '100%',
          maxHeight: 220,
          borderRadius: 1.5,
          display: 'block',
        }}
      />
      {body && (
        <Typography variant="body2" sx={{ color: textColor, fontSize: 13.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {body}
        </Typography>
      )}
    </Box>
  );
}
