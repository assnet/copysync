import { Alert, AlertTitle, Box, Grid, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { PageHeader, SwipeCards } from '@/components';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import { SAVER_PLAN_CATALOG, type SaverBillingPeriod } from '../plans/catalog';
import { SaverPlanCard } from '../plans/SaverPlanCard';
import { saverPlansStrings as t } from '../plans/strings';
import { useSaverCurrentPlan } from '../plans/useSaverCurrentPlan';

/**
 * Vitrine de planos do Saver (fora do guard de produto: é o destino do cadeado). Preço vem do
 * catálogo do painel, nunca da API; o plano atual vem de `GET /subscription` só para destaque.
 */
export function SaverPlansPage() {
  const [period, setPeriod] = usePersistedState<SaverBillingPeriod>('saverPlans.period', 'annual');
  const currentSlug = useSaverCurrentPlan();
  const { tenants, activeTenantId } = useTenant();
  const isSuperAdmin = useAuth().user?.isSuperAdmin === true;
  // ADMIN da conta ou super admin (que ativa planos pelo suporte); operador vê a orientação.
  const canSubscribe = isSuperAdmin || tenants.find((x) => x.id === activeTenantId)?.role === 'ADMIN';
  const initialKey = SAVER_PLAN_CATALOG.find((p) => p.planSlug === currentSlug)?.tier
    ?? SAVER_PLAN_CATALOG.find((p) => p.recommended)?.tier;

  return (
    <Box>
      <PageHeader title={t.page.title} subtitle={t.page.subtitle} />
      <Box sx={{ maxWidth: 1120, mx: 'auto' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, mt: 1 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            color="primary"
            value={period}
            onChange={(_, v: SaverBillingPeriod | null) => { if (v) setPeriod(v); }}
            aria-label={t.period.label}
          >
            <ToggleButton value="monthly">{t.period.monthly}</ToggleButton>
            <ToggleButton value="annual">{t.period.annual}</ToggleButton>
          </ToggleButtonGroup>
          {period === 'annual' && <Typography variant="caption" color="text.secondary">{t.period.annualHint}</Typography>}
        </Box>

        <SwipeCards
          ariaLabel={t.page.carouselLabel}
          initialKey={initialKey}
          items={SAVER_PLAN_CATALOG.map((plan) => ({
            key: plan.tier,
            label: plan.name,
            content: <SaverPlanCard plan={plan} period={period} current={plan.planSlug === currentSlug} canSubscribe={canSubscribe} />,
          }))}
          renderGrid={(items) => (
            <Grid container spacing={2.5} alignItems="stretch" sx={{ mt: 2 }}>
              {items.map((item) => (
                <Grid item xs={12} md={4} key={item.key}>{item.content}</Grid>
              ))}
            </Grid>
          )}
        />

        <Alert severity="info" variant="outlined" sx={{ mt: 3 }}>
          <AlertTitle>{t.hiddenNumber.title}</AlertTitle>
          {t.hiddenNumber.body}
        </Alert>

        <Typography variant="caption" display="block" textAlign="center" color="text.disabled" sx={{ mt: 2.5 }}>
          {t.footnote}
        </Typography>
      </Box>
    </Box>
  );
}
