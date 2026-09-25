import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { authService } from '@/services/auth.service';
import { reactionDispatcher } from '@/features/chat/reactionDispatcher';
import { mediaAccountScope } from '@/features/chat/media/mediaAccountScope';
import type { AuthUser, LoginRequest, TenantRef } from '@/types/api.types';

interface AuthState {
  user: AuthUser | null;
  tenants: TenantRef[];
  accessToken: string | null;
  refreshToken: string | null;
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  login: (data: LoginRequest) => Promise<TenantRef[]>;
  logout: () => Promise<void>;
  setTokens: (accessToken: string, refreshToken: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadInitialState(): AuthState {
  const raw = localStorage.getItem('authUser');
  const user: AuthUser | null = raw ? (JSON.parse(raw) as AuthUser) : null;
  return {
    user,
    tenants: [],
    accessToken: localStorage.getItem('accessToken'),
    refreshToken: localStorage.getItem('refreshToken'),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(loadInitialState);

  const login = useCallback(async (data: LoginRequest): Promise<TenantRef[]> => {
    const result = await authService.login(data);

    localStorage.setItem('accessToken', result.accessToken);
    localStorage.setItem('refreshToken', result.refreshToken);
    localStorage.setItem('authUser', JSON.stringify(result.user));

    setState({
      user: result.user,
      tenants: result.tenants,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });

    return result.tenants;
  }, []);

  const logout = useCallback(async () => {
    // Nada agendado pode sair depois com o token de outro usuário.
    reactionDispatcher.reset();
    mediaAccountScope.reset();
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      try {
        await authService.logout(refreshToken);
      } catch {
        // Ignora erros no logout — limpa estado de qualquer forma
      }
    }

    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('authUser');
    localStorage.removeItem('activeTenantId');
    localStorage.removeItem('activeTenantName');

    setState({ user: null, tenants: [], accessToken: null, refreshToken: null });
  }, []);

  const setTokens = useCallback((accessToken: string, refreshToken: string) => {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    setState((prev) => ({ ...prev, accessToken, refreshToken }));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        isAuthenticated: !!state.accessToken,
        login,
        logout,
        setTokens,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
