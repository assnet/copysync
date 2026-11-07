import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { extensionStrings } from '../strings';
import { EXTENSION_STORE_URL } from '../config';
import { ExtensionInstallPanel } from './ExtensionInstallPanel';

const env = vi.hoisted(() => ({ chromium: true, detect: vi.fn(async () => false), record: vi.fn() }));

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
vi.mock('../services/extensionApi', () => ({ extensionApi: { recordStoreClick: env.record } }));

const t = extensionStrings.install;

beforeEach(() => {
  sessionStorage.clear();
  env.chromium = true;
  env.detect.mockReset().mockResolvedValue(false);
  env.record.mockReset().mockResolvedValue(true);
});

describe('ExtensionInstallPanel', () => {
  it('abre a loja em nova aba, registra o clique com a origem e passa a aguardar', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderWithTheme(<ExtensionInstallPanel source="ml_wizard" onDetected={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: t.storeAction }));
    expect(open).toHaveBeenCalledWith(EXTENSION_STORE_URL, '_blank', 'noopener');
    expect(env.record).toHaveBeenCalledWith('ml_wizard');
    expect(await screen.findByText(t.waitingTitle)).toBeInTheDocument();
  });

  it('falha ou deduplicação na API não impede abrir a loja nem a espera', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    env.record.mockRejectedValueOnce(new Error('offline'));
    renderWithTheme(<ExtensionInstallPanel source="settings" onDetected={vi.fn()} />, 'dark');
    fireEvent.click(screen.getByRole('button', { name: t.storeAction }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(t.waitingTitle)).toBeInTheDocument();

    env.record.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: t.storeAgain }));
    expect(open).toHaveBeenCalledTimes(2);
    expect(screen.getByText(t.waitingTitle)).toBeInTheDocument();
  });

  it('avança sozinho ao detectar (verificar de novo)', async () => {
    const onDetected = vi.fn();
    env.detect.mockResolvedValue(true);
    renderWithTheme(<ExtensionInstallPanel source="settings" onDetected={onDetected} />);
    fireEvent.click(screen.getByRole('button', { name: t.recheckAction }));
    await waitFor(() => expect(onDetected).toHaveBeenCalledTimes(1));
    expect(screen.getByText(t.detectedTitle)).toBeInTheDocument();
  });

  it('navegador incompatível: só o aviso, sem botão de instalar', () => {
    env.chromium = false;
    renderWithTheme(<ExtensionInstallPanel source="settings" onDetected={vi.fn()} />);
    expect(screen.getByText(t.incompatibleTitle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.storeAction })).toBeNull();
  });
});
