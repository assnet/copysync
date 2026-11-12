import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { PrivateRoute } from './PrivateRoute';
import { AppLayout } from '@/app/AppLayout';
import { LoginPage } from '@/pages/LoginPage';
import { InvitePage } from '@/pages/InvitePage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { FORGOT_PASSWORD_PATH, RESET_PASSWORD_PATH } from '@/features/passwordReset/strings';
import { PrivacyPolicyPage } from '@/pages/PrivacyPolicyPage';
import { PRIVACY_POLICY_PATH } from '@/features/privacy-policy/strings';
import { SupportPage } from '@/pages/SupportPage';
import { SUPPORT_PATH } from '@/features/support/strings';
import { DashboardPage } from '@/pages/DashboardPage';
import SessionsPage from '@/pages/SessionsPage';
import ChatPage from '@/pages/ChatPage';
import { SettingsLayout } from '@/features/settings/components/SettingsLayout';
import { SettingsAccountPage } from '@/pages/settings/SettingsAccountPage';
import { ChangePasswordPage } from '@/pages/settings/ChangePasswordPage';
import { AffiliateCredentialsPage } from '@/pages/settings/AffiliateCredentialsPage';
import { AiSettingsPage } from '@/pages/settings/AiSettingsPage';
import { ExtensionSettingsPage } from '@/pages/settings/ExtensionSettingsPage';
import { SubscriptionPage } from '@/pages/settings/SubscriptionPage';
import { AdminAiPage } from '@/pages/admin/AdminAiPage';
import { AdminLinkDomainsPage } from '@/pages/admin/AdminLinkDomainsPage';
import { AdminWorkersPage } from '@/pages/admin/AdminWorkersPage';
import { AdminCostsPage } from '@/pages/admin/AdminCostsPage';
import { AdminRedirectLinksPage } from '@/pages/admin/AdminRedirectLinksPage';
import { AdminPlanEntitlementsPage } from '@/pages/admin/AdminPlanEntitlementsPage';
import { RedirectPage } from '@/pages/RedirectPage';
import { ThankYouPage } from '@/pages/ThankYouPage';
import { THANK_YOU_PATH } from '@/features/thankYou/strings';
import { ExtensionRemovedPage } from '@/pages/ExtensionRemovedPage';
import { EXTENSION_REMOVED_PATH } from '@/features/extension/config';
import { REDIRECT_PUBLIC_PATH } from '@/features/redirectLinks/strings';
import { SuperAdminRoute } from '@/features/ai/components/SuperAdminRoute';
import { OfferGeneratorPage } from '@/pages/offers/OfferGeneratorPage';
import { MembersPage, MirroringPage } from '@/pages/modules';
import { StorefrontPage } from '@/features/storefront/StorefrontPage';
import { OfferStoryPage } from '@/features/offerStory/OfferStoryPage';
import { MonitoringPage } from '@/pages/monitoring/MonitoringPage';
import { LinkRotationPage } from '@/pages/link-rotation/LinkRotationPage';
import { BroadcastGroupsPage } from '@/pages/broadcast-groups/BroadcastGroupsPage';
import { PlansPage } from '@/pages/plans/PlansPage';
import { AFFILIATE_CREDENTIALS_PATH, AFFILIATE_PLANS_PATH } from '@/features/navigation';

function LegacyAffiliateCredentialsRedirect() {
  const { search } = useLocation();
  return <Navigate to={`${AFFILIATE_CREDENTIALS_PATH}${search}`} replace />;
}

function LegacyPlansRedirect() {
  const { search } = useLocation();
  return <Navigate to={`${AFFILIATE_PLANS_PATH}${search}`} replace />;
}

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
      {/* Esqueci minha senha: pedido do link e redefinição pelo link do e-mail (docs/seguranca-login.md) */}
      <Route path={FORGOT_PASSWORD_PATH} element={<ForgotPasswordPage />} />
      <Route path={`${RESET_PASSWORD_PATH}/:token`} element={<ResetPasswordPage />} />
      {/* URL declarada na Chrome Web Store: precisa abrir sem login */}
      <Route path={PRIVACY_POLICY_PATH} element={<PrivacyPolicyPage />} />
      <Route path={SUPPORT_PATH} element={<SupportPage />} />
      {/* Links de redirecionamento da plataforma: sem login, sem layout (docs/redirect-links.md) */}
      <Route path={`${REDIRECT_PUBLIC_PATH}/:slug`} element={<RedirectPage />} />
      {/* Página de obrigado pós-compra (checkout): estática, sem API (docs/pagina-obrigado.md) */}
      <Route path={THANK_YOU_PATH} element={<ThankYouPage />} />
      {/* Pública: aberta pela extensão ao ser desinstalada (pesquisa de motivo) */}
      <Route path={EXTENSION_REMOVED_PATH} element={<ExtensionRemovedPage />} />

      {/* Privadas — dentro do layout autenticado */}
      <Route element={<PrivateRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          {/* Caminho antigo: sessões agora ficam em Configurações; mantém query (?create=1&returnTo=…) */}
          <Route path="/sessions" element={<LegacySessionsRedirect />} />
          <Route path="/offers" element={<OfferGeneratorPage />} />
          <Route path="/monitoring" element={<MonitoringPage />} />
          <Route path="/link-rotation" element={<LinkRotationPage />} />
          <Route path="/broadcast-groups" element={<BroadcastGroupsPage />} />
          <Route path="/mirroring" element={<MirroringPage />} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/storefront" element={<StorefrontPage />} />
          <Route path="/offer-story" element={<OfferStoryPage />} />
          <Route path={AFFILIATE_CREDENTIALS_PATH} element={<AffiliateCredentialsPage />} />
          <Route path={AFFILIATE_PLANS_PATH} element={<PlansPage />} />
          {/* Caminho antigo: planos agora são por produto; mantém query (?feature=…) */}
          <Route path="/plans" element={<LegacyPlansRedirect />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="/settings/sessions" replace />} />
            <Route path="sessions" element={<SessionsPage />} />
            <Route path="account" element={<SettingsAccountPage />} />
            <Route path="account/password" element={<ChangePasswordPage />} />
            {/* Caminho antigo: credenciais agora ficam em Afiliados; mantém query (?returnTo=…) */}
            <Route path="affiliate-credentials" element={<LegacyAffiliateCredentialsRedirect />} />
            <Route path="ai" element={<AiSettingsPage />} />
            <Route path="extension" element={<ExtensionSettingsPage />} />
            <Route path="subscription" element={<SubscriptionPage />} />
          </Route>
          <Route element={<SuperAdminRoute />}>
            {/* Chat: só super admin por enquanto (fora do menu dos demais) */}
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/admin/ai" element={<AdminAiPage />} />
            <Route path="/admin/link-domains" element={<AdminLinkDomainsPage />} />
            <Route path="/admin/workers" element={<AdminWorkersPage />} />
            <Route path="/admin/workers/usage" element={<AdminWorkersPage />} />
            <Route path="/admin/workers/capacity" element={<AdminWorkersPage />} />
            <Route path="/admin/workers/settings" element={<AdminWorkersPage />} />
            <Route path="/admin/workers/scale" element={<AdminWorkersPage />} />
            <Route path="/admin/costs" element={<AdminCostsPage />} />
            <Route path="/admin/redirect-links" element={<AdminRedirectLinksPage />} />
            <Route path="/admin/plan-entitlements" element={<AdminPlanEntitlementsPage />} />
          </Route>
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
