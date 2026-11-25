import { Box, CircularProgress } from '@mui/material';
import { Navigate, Outlet } from 'react-router-dom';
import { offerWatermarkStrings as t } from '../strings';
import { useOfferWatermarkAccess } from '../hooks/useOfferWatermarkAccess';

/**
 * Guard da rota da marca d'água: visibilidade vem da API (`GET /offer-watermark/access`), nunca de papel
 * fixo no front. Invisível → `/dashboard`.
 */
export function OfferWatermarkRoute() {
  const { visible, loading } = useOfferWatermarkAccess();
  if (loading) {
    return (
      <Box role="status" aria-label={t.page.loading} sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  return visible ? <Outlet /> : <Navigate to="/dashboard" replace />;
}
