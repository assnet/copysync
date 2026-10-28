import { Box, Typography, alpha, useTheme, type Theme } from '@mui/material';
import { Crown } from 'lucide-react';
import { AppIcon } from '@/components';
import { GuaranteeSeal } from './GuaranteeSeal';
import { plansStrings as t } from '../strings';

export function ctaGradient(theme: Theme): string {
  return `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`;
}

/** Banner da vitrine: ícone, título, lead e selo de garantia. Só tokens do tema. */
export function PlansHero() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'visible',
        borderRadius: '20px',
        px: { xs: 2.5, sm: 5 },
        py: { xs: 4, sm: 5 },
        textAlign: 'center',
        border: '1px solid',
        borderColor: alpha(theme.palette.primary.main, isDark ? 0.35 : 0.2),
        background: isDark
          ? `radial-gradient(120% 140% at 50% -20%, ${alpha(theme.palette.primary.main, 0.35)} 0%, ${alpha(theme.palette.secondary.main, 0.12)} 45%, ${theme.palette.background.paper} 100%)`
          : `radial-gradient(120% 140% at 50% -20%, ${alpha(theme.palette.primary.main, 0.18)} 0%, ${alpha(theme.palette.secondary.main, 0.08)} 45%, ${theme.palette.background.paper} 100%)`,
      }}
    >
      <Box sx={{ position: 'absolute', top: -28, left: -20, display: { xs: 'none', md: 'block' }, pointerEvents: 'none' }}>
        <GuaranteeSeal />
      </Box>

      <Box
        sx={{
          mx: 'auto', width: 48, height: 48, borderRadius: 3, display: 'grid', placeItems: 'center', color: '#fff',
          backgroundImage: ctaGradient(theme),
          boxShadow: `0 0 0 5px ${alpha(theme.palette.primary.main, 0.12)}, 0 10px 24px -8px ${alpha(theme.palette.primary.main, 0.6)}`,
        }}
      >
        <AppIcon icon={Crown} size="lg" />
      </Box>

      <Typography variant="overline" sx={{ display: 'block', mt: 2.5, color: 'primary.main', fontWeight: 800, letterSpacing: 1.2 }}>
        {t.hero.eyebrow}
      </Typography>
      <Typography variant="h4" sx={{ mt: 0.5 }}>
        {t.hero.title}
      </Typography>
      <Typography variant="body1" sx={{ mt: 1.5, mx: 'auto', maxWidth: 560, color: 'text.secondary' }}>
        <Box component="b" sx={{ color: 'text.primary', fontWeight: 700 }}>{t.hero.lead}</Box> {t.hero.leadDetail}
      </Typography>
    </Box>
  );
}
