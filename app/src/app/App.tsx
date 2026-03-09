import { BrowserRouter } from 'react-router-dom';
import { ColorModeProvider } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { TenantProvider } from '@/contexts/TenantContext';
import { AppRoutes } from '@/routes/AppRoutes';

export function App() {
  return (
    <BrowserRouter>
      <ColorModeProvider>
        <AuthProvider>
          <TenantProvider>
            <AppRoutes />
          </TenantProvider>
        </AuthProvider>
      </ColorModeProvider>
    </BrowserRouter>
  );
}
