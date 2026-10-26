import { Routes, Route, Navigate } from 'react-router-dom';
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
import { OfferGeneratorPage } from '@/pages/offers/OfferGeneratorPage';

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
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/offers" element={<OfferGeneratorPage />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="/settings/account" replace />} />
            <Route path="account" element={<SettingsAccountPage />} />
            <Route path="account/password" element={<ChangePasswordPage />} />
            <Route path="affiliate-credentials" element={<AffiliateCredentialsPage />} />
          </Route>
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
