import { Box, Chip, ToggleButton, ToggleButtonGroup, Typography, alpha, useTheme, type Theme } from '@mui/material';
import { Crown } from 'lucide-react';
import { AppIcon } from '@/components';
import { GuaranteeSeal } from './GuaranteeSeal';
import { ANNUAL_DISCOUNT, type BillingPeriod } from '../catalog';
import { plansStrings as t } from '../strings';

export function ctaGradient(theme: Theme): string {
  return `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`;
}

interface Props {
  period: BillingPeriod;
  onPeriodChange: (period: BillingPeriod) => void;
}

/** Banner da vitrine: ícone, título, lead, toggle mensal/anual e selo de garantia. Só tokens do tema. */
export function PlansHero({ period, onPeriodChange }: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const gradient = ctaGradient(theme);
  const discount = t.period.discount(Math.round(ANNUAL_DISCOUNT * 100));
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

      <ToggleButtonGroup
        exclusive
        value={period}
        onChange={(_, next: BillingPeriod | null) => { if (next) onPeriodChange(next); }}
        aria-label={t.period.groupLabel}
        sx={{
          mt: 3, p: 0.5, borderRadius: 999, gap: 0.5,
          bgcolor: alpha(theme.palette.text.primary, isDark ? 0.08 : 0.06),
          '& .MuiToggleButtonGroup-grouped': {
            border: 0, borderRadius: '999px !important', px: 2, py: 0.75, textTransform: 'none', fontWeight: 600, fontSize: 14,
            color: 'text.secondary', gap: 0.75,
            '&.Mui-selected': { color: '#fff', backgroundImage: gradient, boxShadow: theme.shadows[1] },
            '&.Mui-selected:hover': { backgroundImage: gradient, filter: 'brightness(1.06)' },
          },
        }}
      >
        <ToggleButton value="monthly">{t.period.monthly}</ToggleButton>
        <ToggleButton value="annual">
          {t.period.annual}
          <Chip
            component="span"
            label={discount}
            size="small"
            sx={{
              height: 18, fontSize: 10, fontWeight: 800,
              bgcolor: period === 'annual' ? alpha('#fff', 0.22) : alpha(theme.palette.success.main, 0.16),
              color: period === 'annual' ? '#fff' : 'success.main',
            }}
          />
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
}
