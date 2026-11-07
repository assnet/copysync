import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const loginConfig = vi.fn();
vi.mock('@/services/auth.service', () => ({ authService: { loginConfig: () => loginConfig() } }));
vi.mock('./config', () => ({ FALLBACK_TURNSTILE_SITE_KEY: 'fallback-key' }));

import { useLoginConfig } from './useLoginConfig';

beforeEach(() => loginConfig.mockReset());

describe('useLoginConfig', () => {
  it('usa a site key da API (null = sem widget)', async () => {
    loginConfig.mockResolvedValueOnce({ mode: 'enforce', turnstileSiteKey: 'api-key', emailCode: true });
    const a = renderHook(() => useLoginConfig());
    await waitFor(() => expect(a.result.current.loaded).toBe(true));
    expect(a.result.current.siteKey).toBe('api-key');

    loginConfig.mockResolvedValueOnce({ mode: 'monitor', turnstileSiteKey: null, emailCode: false });
    const b = renderHook(() => useLoginConfig());
    await waitFor(() => expect(b.result.current.loaded).toBe(true));
    expect(b.result.current.siteKey).toBe('');
  });

  it('config indisponível: cai na VITE_TURNSTILE_SITE_KEY', async () => {
    loginConfig.mockRejectedValueOnce(new Error('rede'));
    const { result } = renderHook(() => useLoginConfig());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.siteKey).toBe('fallback-key');
  });
});
