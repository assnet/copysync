import { Box, Typography, alpha, useTheme } from '@mui/material';
import AudiotrackIcon from '@mui/icons-material/Audiotrack';
import MicIcon from '@mui/icons-material/Mic';

interface Props {
  mediaUrl?: string | null;
  mimeType?: string | null;
  durationSeconds?: number | null;
  isOut: boolean;
}

function formatDuration(sec: number | null | undefined): string {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function AudioMessage({ mediaUrl, mimeType, durationSeconds, isOut }: Props) {
  const theme = useTheme();
  const isPtt = mimeType?.includes('ogg') || mimeType?.includes('opus');

  if (!mediaUrl) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          p: 1.5,
          bgcolor: alpha(theme.palette.text.primary, 0.06),
          borderRadius: 1.5,
          color: 'text.secondary',
        }}
      >
        {isPtt ? (
          <MicIcon sx={{ fontSize: 24 }} />
        ) : (
          <AudiotrackIcon sx={{ fontSize: 24 }} />
        )}
        <Box>
          <Typography variant="caption" display="block">
            {isPtt ? 'Mensagem de voz' : 'Áudio'}
          </Typography>
          {durationSeconds && (
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>
              {formatDuration(durationSeconds)}
            </Typography>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {isPtt ? (
          <MicIcon sx={{ fontSize: 18, color: isOut ? 'rgba(255,255,255,0.7)' : 'text.secondary' }} />
        ) : (
          <AudiotrackIcon sx={{ fontSize: 18, color: isOut ? 'rgba(255,255,255,0.7)' : 'text.secondary' }} />
        )}
        {durationSeconds && (
          <Typography variant="caption" sx={{ color: isOut ? 'rgba(255,255,255,0.7)' : 'text.secondary', fontSize: 10 }}>
            {formatDuration(durationSeconds)}
          </Typography>
        )}
      </Box>
      <Box
        component="audio"
        controls
        src={mediaUrl}
        sx={{
          width: '100%',
          maxWidth: 260,
          height: 36,
          borderRadius: 1,
          outline: 'none',
          '&::-webkit-media-controls-panel': {
            bgcolor: 'transparent',
          },
        }}
      />
    </Box>
  );
}
