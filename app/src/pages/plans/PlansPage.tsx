import { Box, Grid, Typography } from '@mui/material';
import { PageHeader } from '@/components';
import { PLAN_CATALOG, PlanCard, PlansHero, PlansTrustStrip, plansStrings as t } from '@/features/plans';

/**
 * Vitrine de planos. Só visual por enquanto: o botão aponta para `#` até o checkout da central
 * existir (ver docs/planos.md). Sem dado sensível: não precisa de flag de privacidade.
 */
export function PlansPage() {
  return (
    <Box>
      <PageHeader title={t.page.title} subtitle={t.page.subtitle} />

      <Box sx={{ maxWidth: 1120, mx: 'auto' }}>
        <PlansHero />

        <Grid container spacing={2.5} alignItems="stretch" sx={{ mt: 2 }}>
          {PLAN_CATALOG.map((plan) => (
            <Grid item xs={12} md={4} key={plan.slug} sx={{ pt: { xs: 2, md: 0 } }}>
              <PlanCard plan={plan} checkoutHref="#" />
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
