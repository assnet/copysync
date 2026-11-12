import { Box, CircularProgress } from '@mui/material';
import { Navigate, Outlet } from 'react-router-dom';
import { offerHunterStrings as t } from '../strings';
import { useOfferHunterAccess } from '../hooks/useOfferHunterAccess';

/**
 * Guard das rotas do caçador: visibilidade vem da API (`GET /offer-hunts/access`), nunca de papel fixo
 * no front (abrir ao público é só trocar a env da API). Invisível → `/dashboard`.
 */
export function OfferHunterRoute() {
  const { visible, loading } = useOfferHunterAccess();
  if (loading) {
    return (
      <Box role="status" aria-label={t.page.loading} sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  return visible ? <Outlet /> : <Navigate to="/dashboard" replace />;
}
