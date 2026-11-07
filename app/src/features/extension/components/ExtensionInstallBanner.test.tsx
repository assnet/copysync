import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { extensionStrings } from '../strings';
import { ExtensionInstallBanner, installBannerDismissKey } from './ExtensionInstallBanner';

const env = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  chromium: true,
  detect: vi.fn(async () => false),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: env.user }) }));
vi.mock('../config', async (orig) => ({
  ...(await orig<typeof import('../config')>()),
  isChromiumDesktop: () => env.chromium,
  isExtensionCapableBrowser: () => env.chromium,
}));
vi.mock('../channel/client', () => ({
  detectExtension: env.detect,
  hasConfiguredExtensionIds: () => true,
  isExtensionChannelBound: () => true,
}));
vi.mock('../services/extensionApi', () => ({ extensionApi: { recordStoreClick: vi.fn(async () => true) } }));

const t = extensionStrings.banner;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  env.user = { id: 'u1' };
  env.chromium = true;
  env.detect.mockReset().mockResolvedValue(false);
});

describe('ExtensionInstallBanner', () => {
  it('aparece sem a extensão; dispensar persiste só para este usuário', async () => {
    const { unmount } = renderWithTheme(<ExtensionInstallBanner />);
    expect(await screen.findByText(t.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.dismiss }));
    expect(screen.queryByText(t.title)).toBeNull();
    expect(localStorage.getItem(`ui.${installBannerDismissKey('u1')}`)).not.toBeNull();
    unmount();

    renderWithTheme(<ExtensionInstallBanner />);
    await waitFor(() => expect(env.detect).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(t.title)).toBeNull();
    cleanupAndRender('u2');
    expect(await screen.findByText(t.title)).toBeInTheDocument();
  });

  it('não aparece com a extensão detectada nem em navegador incompatível', async () => {
    env.detect.mockResolvedValue(true);
    renderWithTheme(<ExtensionInstallBanner />);
    await waitFor(() => expect(env.detect).toHaveBeenCalled());
    expect(screen.queryByText(t.title)).toBeNull();

    env.chromium = false;
    cleanupAndRender('u1', 'dark');
    expect(screen.queryByText(t.title)).toBeNull();
  });
});

function cleanupAndRender(userId: string, mode: 'light' | 'dark' = 'light') {
  cleanup();
  env.user = { id: userId };
  return renderWithTheme(<ExtensionInstallBanner />, mode);
}
