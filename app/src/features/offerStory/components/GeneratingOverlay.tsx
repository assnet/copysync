import { useEffect, useState } from 'react';
import { Backdrop, Box, CircularProgress, Stack, Typography, alpha, useTheme } from '@mui/material';
import { Check } from 'lucide-react';
import { AppIcon } from '@/components';
import { offerStoryStrings } from '../strings';
import { REDUCED_MOTION, floatShadow, riseIn, shimmer, storyGradient } from '../storyStyle';

const t = offerStoryStrings.generating;
/** Ritmo visual das etapas (a API não reporta progresso; a última fica girando até terminar). */
const STEP_MS = 1600;

/** Cobre a tela enquanto a API extrai o produto e renderiza a arte, contando as etapas. */
export function GeneratingOverlay({ open }: { open: boolean }) {
  const theme = useTheme();
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    setActive(0);
    const id = setInterval(() => setActive((i) => Math.min(i + 1, t.steps.length - 1)), STEP_MS);
    return () => clearInterval(id);
  }, [open]);

  return (
    <Backdrop
      open={open}
      sx={{ zIndex: theme.zIndex.modal + 1, bgcolor: alpha(theme.palette.background.default, 0.8), backdropFilter: 'blur(8px)' }}
    >
      <Box
        role="status"
        aria-live="polite"
        sx={{
          width: 'min(360px, calc(100vw - 32px))', p: 3, borderRadius: '20px', bgcolor: 'background.paper',
          border: '1px solid', borderColor: 'divider', boxShadow: floatShadow(theme, true),
          animation: `${riseIn} 240ms ease-out`, [REDUCED_MOTION]: { animation: 'none' },
        }}
      >
        <Box
          aria-hidden
          sx={{
            height: 4, borderRadius: 999, mb: 2.5, backgroundImage: storyGradient(theme, 90), backgroundSize: '200% 100%',
            animation: `${shimmer} 1.6s linear infinite`,
            [REDUCED_MOTION]: { animation: 'none' },
          }}
        />
        <Typography variant="h6" component="p" sx={{ fontWeight: 800, color: 'text.primary' }}>{t.title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>{t.subtitle}</Typography>

        <Stack component="ol" spacing={1.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {t.steps.map((label, i) => {
            const done = i < active;
            const current = i === active;
            return (
              <Box
                component="li"
                key={label}
                aria-current={current ? 'step' : undefined}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: done || current ? 'text.primary' : 'text.disabled', transition: 'color 200ms' }}
              >
                <Box aria-hidden sx={{ width: 26, height: 26, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  {done ? (
                    <Box sx={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'success.main', color: 'common.white' }}>
                      <AppIcon icon={Check} size="sm" strokeWidth={3} />
                    </Box>
                  ) : current ? (
                    <CircularProgress size={20} thickness={5} color="secondary" sx={{ [REDUCED_MOTION]: { animation: 'none', '& circle': { animation: 'none', strokeDasharray: '60px, 200px', strokeDashoffset: 0 } } }} />
                  ) : (
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid', borderColor: 'divider' }} />
                  )}
                </Box>
                <Typography variant="body2" sx={{ fontWeight: current ? 700 : 500, color: 'inherit' }}>{label}</Typography>
              </Box>
            );
          })}
        </Stack>
      </Box>
    </Backdrop>
  );
}
