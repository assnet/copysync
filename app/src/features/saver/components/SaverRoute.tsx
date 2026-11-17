import { Navigate, Outlet } from 'react-router-dom';
import { ProductAccessLoading, SUBSCRIPTION_PATH } from '@/features/products';
import { useSaverAccess } from '../hooks/useSaverAccess';

/**
 * Guard de audiência de todas as rotas do Saver (vitrine inclusive): visibilidade vem da API
 * (`GET /saver/access`), nunca de papel fixo no front. Invisível → assinatura (nunca o índice: o
 * início de um tenant só-Saver é `/saver`, e voltar a ele daria laço).
 */
export function SaverRoute() {
  const { visible, loading } = useSaverAccess();
  if (loading) return <ProductAccessLoading />;
  return visible ? <Outlet /> : <Navigate to={SUBSCRIPTION_PATH} replace />;
}
