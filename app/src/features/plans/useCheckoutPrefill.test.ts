import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const account = vi.hoisted(() => ({ getCheckoutPrefill: vi.fn() }));
vi.mock('@/services/account.service', () => ({ accountService: account }));

import { useCheckoutPrefill } from './useCheckoutPrefill';

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('useCheckoutPrefill', () => {
  it('busca ao montar com timeout curto, guarda só as chaves conhecidas e nada no storage', async () => {
    account.getCheckoutPrefill.mockResolvedValue({ email: 'ana@x.com', confirmEmail: 'ana@x.com', name: 'Ana', phone: '1' });
    const { result } = renderHook(() => useCheckoutPrefill());
    expect(account.getCheckoutPrefill).toHaveBeenCalledWith(expect.objectContaining({ timeout: 2500 }));
    await waitFor(() => expect(result.current()).toEqual({ email: 'ana@x.com', confirmEmail: 'ana@x.com', name: 'Ana' }));
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it('falha → {}', async () => {
    account.getCheckoutPrefill.mockRejectedValue(new Error('timeout'));
    const { result } = renderHook(() => useCheckoutPrefill());
    await waitFor(() => expect(account.getCheckoutPrefill).toHaveBeenCalled());
    await Promise.resolve();
    expect(result.current()).toEqual({});
  });
});
