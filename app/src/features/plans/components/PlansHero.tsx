import { Box, Chip, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha, useTheme, type Theme } from '@mui/material';
import { Crown } from 'lucide-react';
import { AppIcon } from '@/components';
import type { AffiliateProvider } from '@/types/api.types';
import { AFFILIATE_PROVIDERS } from '@/features/settings/affiliateProviders';
import { MarketplaceLogo } from '@/features/settings/components/MarketplaceLogo';
import { GuaranteeSeal } from './GuaranteeSeal';
import { ANNUAL_DISCOUNT, type BillingPeriod } from '../catalog';
import { plansStrings as t } from '../strings';

/** Texto só para leitor de tela (mesmo padrão de `ChannelLimitsTable`). */
const visuallyHidden = {
  position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;

/** Selo por marketplace no banner (texto de marketing do plano); provider sem entrada não tem selo. */
const PROVIDER_SEAL: Partial<Record<AffiliateProvider, { label: string; tooltip: string }>> = {
  SHEIN: { label: t.hero.sheinPlan, tooltip: t.hero.sheinTooltip },
  MERCADO_LIVRE: { label: t.hero.mercadoLivreTagsPlan, tooltip: t.hero.mercadoLivreTagsTooltip },
};

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

      <Box
        component="ul"
        aria-label={t.hero.marketplaces}
        sx={{ listStyle: 'none', m: 0, p: 0, mt: 2.5, display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 1.5 }}
      >
        {AFFILIATE_PROVIDERS.map((spec) => {
          const seal = PROVIDER_SEAL[spec.provider];
          const label = seal?.tooltip ?? spec.name;
          return (
            <Tooltip key={spec.provider} title={label} arrow>
              <Box component="li" sx={{ position: 'relative' }}>
                <MarketplaceLogo src={spec.logo} size={40} round />
                <Box component="span" sx={visuallyHidden}>{label}</Box>
                {seal && (
                  <Box
                    component="span"
                    aria-hidden
                    sx={{
                      position: 'absolute', right: -6, bottom: -4, px: 0.5, borderRadius: 999,
                      // Fundo sólido escuro: branco em 10 px precisa de contraste ≥ 4,5:1 (gradiente cai abaixo)
                      fontSize: 10, fontWeight: 800, lineHeight: '15px', color: '#fff', bgcolor: 'primary.dark',
                    }}
                  >
                    {seal.label}
                  </Box>
                )}
              </Box>
            </Tooltip>
          );
        })}
      </Box>

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
