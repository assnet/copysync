import { Box, Grid, Typography } from '@mui/material';
import { PageHeader } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { PLAN_CATALOG, PlanCard, PlansHero, PlansTrustStrip, plansStrings as t, type BillingPeriod } from '@/features/plans';

/**
 * Vitrine de planos. Só visual por enquanto: o botão aponta para `#` até o checkout da central
 * existir (ver docs/planos.md). Sem dado sensível: não precisa de flag de privacidade.
 */
export function PlansPage() {
  // Anual é o padrão (como no Pulso); a escolha sobrevive a reload na aba
  const [period, setPeriod] = usePersistedState<BillingPeriod>('plans.period', 'annual');
  return (
    <Box>
      <PageHeader title={t.page.title} subtitle={t.page.subtitle} />

      <Box sx={{ maxWidth: 1120, mx: 'auto' }}>
        <PlansHero period={period} onPeriodChange={setPeriod} />

        <Grid container spacing={2.5} alignItems="stretch" sx={{ mt: 2 }}>
          {PLAN_CATALOG.map((plan) => (
            <Grid item xs={12} md={4} key={plan.slug} sx={{ pt: { xs: 2, md: 0 } }}>
              <PlanCard plan={plan} period={period} checkoutHref="#" />
            </Grid>
          ))}
        </Grid>

        <Box sx={{ mt: 4 }}>
          <PlansTrustStrip />
        </Box>

        <Typography variant="caption" display="block" textAlign="center" color="text.disabled" sx={{ mt: 2.5 }}>
          {t.footnote}
        </Typography>
      </Box>
    </Box>
  );
}
