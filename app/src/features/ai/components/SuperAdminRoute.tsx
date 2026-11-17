import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

/** Rotas da plataforma: quem não é super admin volta ao início por produto (a API também recusa com 403). */
export function SuperAdminRoute() {
  const { user } = useAuth();
  return user?.isSuperAdmin ? <Outlet /> : <Navigate to="/" replace />;
}
