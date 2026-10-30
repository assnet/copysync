import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { writePersisted } from '@/hooks/usePersistedState';
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
});
