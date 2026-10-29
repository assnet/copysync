import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { PrivateRoute } from './PrivateRoute';
import { AppLayout } from '@/app/AppLayout';
import { LoginPage } from '@/pages/LoginPage';
import { InvitePage } from '@/pages/InvitePage';
import { DashboardPage } from '@/pages/DashboardPage';
import SessionsPage from '@/pages/SessionsPage';
import ChatPage from '@/pages/ChatPage';
import { SettingsLayout } from '@/features/settings/components/SettingsLayout';
import { SettingsAccountPage } from '@/pages/settings/SettingsAccountPage';
import { ChangePasswordPage } from '@/pages/settings/ChangePasswordPage';
import { AffiliateCredentialsPage } from '@/pages/settings/AffiliateCredentialsPage';
import { AiSettingsPage } from '@/pages/settings/AiSettingsPage';
import { ExtensionSettingsPage } from '@/pages/settings/ExtensionSettingsPage';
import { AdminAiPage } from '@/pages/admin/AdminAiPage';
import { AdminLinkDomainsPage } from '@/pages/admin/AdminLinkDomainsPage';
import { SuperAdminRoute } from '@/features/ai/components/SuperAdminRoute';
import { OfferGeneratorPage } from '@/pages/offers/OfferGeneratorPage';
import { MembersPage, MirroringPage, StorefrontPage } from '@/pages/modules';
import { MonitoringPage } from '@/pages/monitoring/MonitoringPage';
import { LinkRotationPage } from '@/pages/link-rotation/LinkRotationPage';
import { PlansPage } from '@/pages/plans/PlansPage';

function LegacySessionsRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/settings/sessions${search}`} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      {/* Públicas */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />

      {/* Privadas — dentro do layout autenticado */}
      <Route element={<PrivateRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          {/* Caminho antigo: sessões agora ficam em Configurações; mantém query (?create=1&returnTo=…) */}
          <Route path="/sessions" element={<LegacySessionsRedirect />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/offers" element={<OfferGeneratorPage />} />
          <Route path="/monitoring" element={<MonitoringPage />} />
          <Route path="/link-rotation" element={<LinkRotationPage />} />
          <Route path="/mirroring" element={<MirroringPage />} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/storefront" element={<StorefrontPage />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="/settings/sessions" replace />} />
            <Route path="sessions" element={<SessionsPage />} />
            <Route path="account" element={<SettingsAccountPage />} />
            <Route path="account/password" element={<ChangePasswordPage />} />
            <Route path="affiliate-credentials" element={<AffiliateCredentialsPage />} />
            <Route path="ai" element={<AiSettingsPage />} />
            <Route path="extension" element={<ExtensionSettingsPage />} />
          </Route>
          <Route element={<SuperAdminRoute />}>
            <Route path="/admin/ai" element={<AdminAiPage />} />
            <Route path="/admin/link-domains" element={<AdminLinkDomainsPage />} />
          </Route>
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
