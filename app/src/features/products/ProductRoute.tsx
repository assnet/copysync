import { Box, CircularProgress } from '@mui/material';
import { Navigate, Outlet } from 'react-router-dom';
import { hasProduct, plansPathFor, resolveHomePath, type ProductKey } from './productAccess';
import { useProductAccess } from './useProductAccess';
import { productAccessStrings as t } from './strings';

/** Indicador enquanto a lista de tenants carrega (guard e redirecionamentos de início). */
export function ProductAccessLoading() {
  return (
    <Box role="status" aria-label={t.loading} sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress size={28} />
    </Box>
  );
}

/**
 * Guard das rotas de um produto: carregando → indicador; sem acesso → vitrine do produto.
 * A vitrine nunca fica sob este guard (senão laço).
 */
export function ProductRoute({ product }: { product: ProductKey }) {
  const { loaded, products } = useProductAccess();
  if (!loaded) return <ProductAccessLoading />;
  return hasProduct(products, product) ? <Outlet /> : <Navigate to={plansPathFor(product)} replace />;
}

/** Índice do painel: espera a lista de tenants e vai para o início do 1º produto com tela. */
export function ProductHomeRedirect() {
  const { loaded, products } = useProductAccess();
  if (!loaded) return <ProductAccessLoading />;
  return <Navigate to={resolveHomePath(products)} replace />;
}
