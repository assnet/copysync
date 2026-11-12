import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { writePersisted } from '@/hooks/usePersistedState';
import { authService } from '@/services/auth.service';
import { AuthProvider, useAuth } from './AuthContext';

vi.mock('@/services/auth.service', () => ({ authService: { logout: vi.fn().mockResolvedValue(undefined) } }));

describe('AuthContext.logout', () => {
  it('limpa o estado de trabalho do Story de Oferta da aba', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    writePersisted('offerStory.result', { image: 'x' });
    writePersisted('offerStory.wizard', { step: 2 });
    const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(() => result.current.logout());

    expect(sessionStorage.getItem('ui.offerStory.result')).toBeNull();
    expect(sessionStorage.getItem('ui.offerStory.wizard')).toBeNull();
    vi.unstubAllGlobals();
  });

  it.each([
    ['401', Object.assign(new Error('unauthorized'), { status: 401 })],
    ['refresh falho', Object.assign(new Error('refresh'), { code: 'REFRESH_FAILED', status: 500 })],
    ['rede', Object.assign(new Error('Network Error'), { serviceUnavailable: true })],
  ])('"Sair" limpa a sessão local mesmo com /auth/logout falhando (%s)', async (_label, failure) => {
    vi.mocked(authService.logout).mockRejectedValueOnce(failure);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    for (const [k, v] of Object.entries({ accessToken: 'a', refreshToken: 'r', authUser: '{}', activeTenantId: 't', activeTenantName: 'T' })) {
      localStorage.setItem(k, v);
    }
    const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(() => result.current.logout());

    expect(authService.logout).toHaveBeenCalledWith('r');
    for (const k of ['accessToken', 'refreshToken', 'authUser', 'activeTenantId', 'activeTenantName']) {
      expect(localStorage.getItem(k)).toBeNull();
    }
    expect(result.current.refreshToken ?? null).toBeNull();
    vi.unstubAllGlobals();
  });
});
