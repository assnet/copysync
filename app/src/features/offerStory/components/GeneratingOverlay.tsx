import { Backdrop, CircularProgress, Stack, Typography, alpha, useTheme } from '@mui/material';
import { offerStoryStrings } from '../strings';

const t = offerStoryStrings.generating;

/** Cobre a tela enquanto a API extrai o produto e renderiza a arte. */
export function GeneratingOverlay({ open }: { open: boolean }) {
  const theme = useTheme();
  return (
    <Backdrop
      open={open}
      sx={{ zIndex: theme.zIndex.modal + 1, bgcolor: alpha(theme.palette.background.default, 0.82), backdropFilter: 'blur(6px)' }}
    >
      <Stack role="status" aria-live="polite" spacing={2} alignItems="center" sx={{ px: 3, textAlign: 'center' }}>
        <CircularProgress size={48} thickness={4} />
        <Typography variant="h6" component="p" sx={{ fontWeight: 700, color: 'text.primary' }}>{t.title}</Typography>
        <Typography variant="body2" color="text.secondary">{t.subtitle}</Typography>
      </Stack>
    </Backdrop>
  );
}
