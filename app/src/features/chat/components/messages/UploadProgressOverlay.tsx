import { Box, CircularProgress, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { chatStrings } from '../../strings';

interface Props {
  /** 0 a 100. Ausente = indeterminado (confirmação ou `PENDING` do servidor). */
  progress?: number;
  /** Só com progresso determinado: interrompe o upload. */
  onCancel?: () => void;
}

const RING = 44;

/**
 * Véu sobre a mídia da bolha em envio (design §14). O pai precisa ser `position: relative`.
 * Anel + cancelar ficam numa pílula escura própria: o contraste não depende da mídia por baixo.
 * Indeterminado (confirmação ou `PENDING` do servidor) não tem o que clicar: o véu deixa o clique
 * passar para tocar ou abrir a mídia.
 */
export function UploadProgressOverlay({ progress, onCancel }: Props) {
  const theme = useTheme();
  const t = chatStrings.upload;
  const determinate = typeof progress === 'number';
  const value = determinate ? Math.round(Math.min(100, Math.max(0, progress))) : 0;
  const label = determinate ? t.progress(value) : t.sending;
  const { black, white } = theme.palette.common;
  const isDark = theme.palette.mode === 'dark';

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 1.5,
        bgcolor: alpha(black, isDark ? 0.4 : 0.28),
        ...(!determinate && { pointerEvents: 'none' }),
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          p: 0.5,
          pr: 1.5,
          borderRadius: 999,
          bgcolor: alpha(black, 0.62),
          color: white,
        }}
      >
        <Box sx={{ position: 'relative', width: RING, height: RING, display: 'grid', placeItems: 'center' }}>
          {/* Trilho: sem ele, 3% de progresso parece um defeito. */}
          <CircularProgress
            variant="determinate"
            value={100}
            size={RING}
            thickness={3}
            aria-hidden
            sx={{ position: 'absolute', inset: 0, color: alpha(white, 0.24) }}
          />
          <CircularProgress
            variant={determinate ? 'determinate' : 'indeterminate'}
            value={determinate ? value : undefined}
            size={RING}
            thickness={3}
            aria-label={t.sending}
            aria-valuetext={determinate ? label : undefined}
            sx={{
              position: 'absolute',
              inset: 0,
              color: white,
              '@media (prefers-reduced-motion: reduce)': {
                animationDuration: '3s',
                '& .MuiCircularProgress-circle': { transition: 'none', animation: 'none' },
              },
            }}
          />
          {determinate && onCancel && (
            <Tooltip title={t.cancel}>
              <IconButton
                aria-label={t.cancel}
                onClick={onCancel}
                sx={{
                  width: 40,
                  height: 40,
                  color: white,
                  '&:hover': { bgcolor: alpha(white, 0.16) },
                  '&:focus-visible': { outline: `2px solid ${white}`, outlineOffset: 1 },
                }}
              >
                <CloseIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <Typography
          aria-hidden
          variant="caption"
          sx={{ color: white, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
        >
          {label}
        </Typography>
      </Box>
    </Box>
  );
}
