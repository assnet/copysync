import { Box, Button, Chip, Divider, Paper, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { Check, Crown, Info } from 'lucide-react';
import { AppIcon } from '@/components';
import type { PlanBenefit, PlanCatalogItem } from '../catalog';
import { formatPrice, plansStrings as t } from '../strings';
import { ctaGradient } from './PlansHero';

interface Props {
  plan: PlanCatalogItem;
  /** Destino do botão. Enquanto o checkout não existe, `#`. */
  checkoutHref: string;
}

function BenefitRow({ benefit, accent }: { benefit: PlanBenefit; accent: string }) {
  const row = (
    <Box component="li" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, cursor: benefit.hint ? 'help' : 'default' }}>
      <Box sx={{ color: accent, mt: '3px', display: 'flex' }}>
        <AppIcon icon={Check} size="sm" strokeWidth={3} />
      </Box>
      <Typography component="div" variant="body2" sx={{ fontWeight: benefit.strong ? 700 : 400, color: benefit.strong ? 'text.primary' : 'text.secondary', lineHeight: 1.45, flex: 1 }}>
        {benefit.label}
        {benefit.exclusive && (
          <Chip label={t.card.exclusive} size="small" color="secondary" variant="outlined" sx={{ ml: 1, height: 18, fontSize: 10, fontWeight: 700, verticalAlign: 'middle' }} />
        )}
      </Typography>
      {benefit.hint && (
        <Box sx={{ color: 'text.disabled', display: 'flex', mt: '3px' }}>
          <AppIcon icon={Info} size="sm" />
        </Box>
      )}
    </Box>
  );
  return benefit.hint ? (
    <Tooltip title={benefit.hint} enterTouchDelay={0} arrow placement="top">
      {row}
    </Tooltip>
  ) : row;
}

/** Card de plano. O recomendado ganha moldura em gradiente e selo "Mais escolhido". */
export function PlanCard({ plan, checkoutHref }: Props) {
  const theme = useTheme();
  const accent = theme.palette.primary.main;
  const recommended = !!plan.recommended;
  const gradient = ctaGradient(theme);
  const savings = plan.priceFrom - plan.price;

  const body = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {recommended && <Box sx={{ color: accent, display: 'flex' }}><AppIcon icon={Crown} size="sm" /></Box>}
          <Typography variant="h6">{plan.name}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {plan.tagline}
        </Typography>
      </Box>

      <Box>
        <Typography variant="caption" sx={{ color: 'text.disabled', textDecoration: 'line-through', fontWeight: 600 }}>
          {t.card.from(formatPrice(plan.priceFrom))}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          <Typography component="span" sx={{ fontSize: 34, fontWeight: 800, lineHeight: 1, letterSpacing: -1, fontVariantNumeric: 'tabular-nums' }}>
            {formatPrice(plan.price)}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary', lineHeight: 1.2 }}>{t.card.perMonth}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>{t.card.billedMonthly}</Typography>
          </Box>
        </Box>
        <Chip
          label={t.card.savings(formatPrice(savings))}
          size="small"
          sx={{ mt: 1, height: 22, fontWeight: 800, fontSize: 11, bgcolor: alpha(theme.palette.success.main, 0.14), color: 'success.main' }}
        />
      </Box>

      <Box>
        <Button
          fullWidth
          size="large"
          variant={recommended ? 'contained' : 'outlined'}
          href={checkoutHref}
          sx={recommended ? { backgroundImage: gradient, boxShadow: 'none', '&:hover': { backgroundImage: gradient, filter: 'brightness(1.06)', boxShadow: 'none' } } : undefined}
        >
          {t.card.cta(plan.name)}
        </Button>
        <Typography variant="caption" display="block" textAlign="center" color="text.secondary" sx={{ mt: 0.75 }}>
          {t.card.ctaHint}
        </Typography>
      </Box>

      <Divider />

      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {plan.benefits.map((b) => <BenefitRow key={b.label} benefit={b} accent={accent} />)}
      </Box>

      <Typography variant="caption" sx={{ mt: 'auto', pt: 2, color: 'text.secondary', borderTop: '1px dashed', borderColor: 'divider' }}>
        <Box component="b" sx={{ color: 'text.primary' }}>{t.card.fit}</Box> {plan.fit}
      </Typography>
    </Box>
  );

  if (recommended) {
    return (
      <Box
        sx={{
          position: 'relative', height: '100%', p: '1.5px', borderRadius: '18px', backgroundImage: gradient,
          boxShadow: `0 12px 40px -14px ${alpha(accent, 0.7)}`,
          transition: 'transform .2s', '&:hover': { transform: 'translateY(-4px)' },
          '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
        }}
      >
        <Chip
          label={t.card.recommended}
          size="small"
          sx={{
            position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', zIndex: 1,
            backgroundImage: gradient, color: '#fff', fontWeight: 800, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', height: 22,
          }}
        />
        <Paper elevation={0} sx={{ height: '100%', p: 2.5, borderRadius: '16.5px' }}>
          {body}
        </Paper>
      </Box>
    );
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        height: '100%', p: 2.5, borderRadius: '18px',
        transition: 'transform .2s', '&:hover': { transform: 'translateY(-4px)' },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
      }}
    >
      {body}
    </Paper>
  );
}
