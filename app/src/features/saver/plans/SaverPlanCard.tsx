import { Box, Button, Chip, Divider, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Check, CreditCard, Info } from 'lucide-react';
import { AppIcon } from '@/components';
import { formatPrice } from '@/features/plans/strings';
import { saverCheckoutPath, saverPriceFor, type SaverBillingPeriod, type SaverPlanCatalogItem } from './catalog';
import { saverPlansStrings as t } from './strings';

interface Props {
  plan: SaverPlanCatalogItem;
  period: SaverBillingPeriod;
  current: boolean;
  /** Só `ADMIN` assina; os demais veem a orientação. */
  canSubscribe: boolean;
}

function Feature({ label, hint }: { label: string; hint?: string }) {
  return (
    <Stack direction="row" spacing={1} alignItems="flex-start" component="li">
      <Box sx={{ color: 'success.main', display: 'inline-flex', pt: 0.25 }}><AppIcon icon={Check} size="sm" /></Box>
      <Typography variant="body2" sx={{ flex: 1 }}>{label}</Typography>
      {hint && (
        <Tooltip title={hint} arrow describeChild enterTouchDelay={0}>
          <Box component="span" tabIndex={0} aria-label={hint} sx={{ color: 'text.secondary', display: 'inline-flex', pt: 0.25 }}>
            <AppIcon icon={Info} size="sm" />
          </Box>
        </Tooltip>
      )}
    </Stack>
  );
}

/** Cartão de um plano do Saver: preço do período, limites e ação. Plano atual em destaque. */
export function SaverPlanCard({ plan, period, current, canSubscribe }: Props) {
  const l = plan.limits;
  const highlight = current || (plan.recommended && !current);
  return (
    <Paper
      variant="outlined"
      data-plan={plan.planSlug}
      data-current={current ? 'true' : undefined}
      sx={(theme) => ({
        p: 3, height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 3,
        borderWidth: highlight ? 2 : 1,
        borderColor: current ? 'success.main' : plan.recommended ? 'primary.main' : 'divider',
        bgcolor: current ? alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.08 : 0.04) : 'background.paper',
      })}
    >
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ minHeight: 28 }}>
        <Typography variant="h6" component="h2" fontWeight={800}>{plan.name}</Typography>
        {current ? (
          <Chip size="small" color="success" label={t.card.current} />
        ) : plan.recommended ? (
          <Chip size="small" color="primary" label={t.card.recommended} />
        ) : null}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, minHeight: 40 }}>{plan.tagline}</Typography>

      <Stack direction="row" alignItems="baseline" spacing={0.5} sx={{ mt: 2 }}>
        <Typography variant="h4" component="p" fontWeight={800}>{formatPrice(saverPriceFor(plan, period))}</Typography>
        <Typography variant="body2" color="text.secondary">{t.card.perMonth}</Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {period === 'annual' ? t.card.annualBilled(plan.priceAnnualMonthly, plan.priceAnnualCash) : t.card.monthlyBilled}
      </Typography>

      <Divider sx={{ my: 2 }} />

      <Stack spacing={1.25} component="ul" sx={{ listStyle: 'none', p: 0, m: 0, flex: 1 }}>
        <Feature label={t.limits.groups(l.groups)} />
        <Feature label={t.limits.contacts(l.contacts)} />
        <Feature label={t.limits.sessions(l.whatsappSessions)} />
        <Feature label={t.limits.scans(l.groupScansPerDay)} hint={t.limits.scansHint} />
        <Feature
          label={l.autoRefresh ? t.limits.autoRefresh : t.limits.noAutoRefresh}
          hint={l.autoRefresh ? t.limits.autoRefreshHint : undefined}
        />
        <Feature label={t.limits.exportFormats} />
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 2 }}>{t.card.fit(plan.fit)}</Typography>

      <Box sx={{ mt: 2 }}>
        {current ? (
          <Button fullWidth variant="outlined" color="success" disabled>{t.card.currentCta}</Button>
        ) : canSubscribe ? (
          <Tooltip title={t.card.ctaTooltip} arrow describeChild>
            <Button
              fullWidth
              variant={plan.recommended ? 'contained' : 'outlined'}
              disableElevation
              component="a"
              href={saverCheckoutPath(plan.tier, period)}
              target="_blank"
              rel="noopener noreferrer"
              startIcon={<AppIcon icon={CreditCard} />}
            >
              {t.card.cta(plan.name)}
            </Button>
          </Tooltip>
        ) : (
          <Typography variant="body2" color="text.secondary" textAlign="center">{t.card.operatorHint}</Typography>
        )}
      </Box>
    </Paper>
  );
}
