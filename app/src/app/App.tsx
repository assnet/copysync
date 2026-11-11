import { BrowserRouter } from 'react-router-dom';
import { ColorModeProvider } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { TenantProvider } from '@/contexts/TenantContext';
import { AppRoutes } from '@/routes/AppRoutes';
import { useDomGuardian } from '@/hooks/useDomGuardian';
import { PrivacyProvider } from '@/features/privacy';
import { SupportChatButton } from '@/features/supportChat';

function AppInner() {
  useDomGuardian();
  return (
    <ColorModeProvider>
      <AuthProvider>
        <TenantProvider>
          <PrivacyProvider>
          <AppRoutes />
          <SupportChatButton />
          </PrivacyProvider>
        </TenantProvider>
      </AuthProvider>
    </ColorModeProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}
