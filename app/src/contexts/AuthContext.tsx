import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { authService } from '@/services/auth.service';
import { reactionDispatcher } from '@/features/chat/reactionDispatcher';
import { mediaAccountScope } from '@/features/chat/media/mediaAccountScope';
import { clearOfferStoryState } from '@/features/offerStory/sessionState';
import type { AuthUser, LoginRequest, LoginResponse, TenantRef } from '@/types/api.types';
import type { LoginCodeChallenge } from '@/features/login-protection/loginProtection';

/** Login concluído (tenants) ou login suspeito que pede o código por e-mail. */
export type LoginOutcome =
  | { status: 'AUTHENTICATED'; tenants: TenantRef[] }
  | { status: 'OTP_REQUIRED'; challenge: LoginCodeChallenge };

interface AuthState {
  user: AuthUser | null;
  tenants: TenantRef[];
  accessToken: string | null;
  refreshToken: string | null;
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  login: (data: LoginRequest) => Promise<LoginOutcome>;
  /** Confirma o código do login suspeito e abre a sessão. */
  verifyLoginCode: (ticket: string, code: string) => Promise<TenantRef[]>;
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

  const applySession = useCallback((result: LoginResponse): TenantRef[] => {
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

  const login = useCallback(async (data: LoginRequest): Promise<LoginOutcome> => {
    const result = await authService.login(data);
    if (result.status === 'OTP_REQUIRED') return result;
    return { status: 'AUTHENTICATED', tenants: applySession(result.session) };
  }, [applySession]);

  const verifyLoginCode = useCallback(
    async (ticket: string, code: string): Promise<TenantRef[]> => applySession(await authService.verifyLoginCode(ticket, code)),
    [applySession],
  );

  const logout = useCallback(async () => {
    // Nada agendado pode sair depois com o token de outro usuário.
    reactionDispatcher.reset();
    mediaAccountScope.reset();
    // Estado de trabalho por conta (arte, link de afiliado) não sobrevive à troca de usuário na aba.
    clearOfferStoryState();
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      try {
        await authService.logout(refreshToken);
      } catch {
        // Ignora erros no logout — limpa estado de qualquer forma
      }
    }

    try {
      const baseUrl = import.meta.env.VITE_API_URL ?? '/api';
      await fetch(`${baseUrl}/extension/session`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'x-client': 'web' },
      });
    } catch {
      // Best-effort — don't block logout
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
        verifyLoginCode,
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
