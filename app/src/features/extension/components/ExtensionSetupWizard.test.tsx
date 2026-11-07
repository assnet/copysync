import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { extensionStrings } from '../strings';
import { ExtensionSetupWizard } from './ExtensionSetupWizard';

const ext = vi.hoisted(() => ({ value: { status: 'not_detected', loading: false } as Record<string, unknown> }));
vi.mock('../hooks/useExtension', () => ({
  useExtension: () => ({ refresh: vi.fn(), handshake: null, mlStatus: null, ...ext.value }),
  syncErrorMessage: () => '',
}));
vi.mock('../config', async (orig) => ({ ...(await orig<typeof import('../config')>()), isChromiumDesktop: () => true }));
vi.mock('../channel/client', () => ({
  detectExtension: vi.fn(async () => false),
  hasConfiguredExtensionIds: () => true,
  isExtensionChannelBound: () => true,
}));

beforeEach(() => sessionStorage.clear());

describe('ExtensionSetupWizard', () => {
  it('começa em Instalar com o painel da loja quando não detectada', () => {
    ext.value = { status: 'not_detected', loading: false };
    renderWithTheme(<ExtensionSetupWizard source="ml_wizard" onComplete={vi.fn()} />);
    expect(screen.getByText(extensionStrings.wizard.stepInstall)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: extensionStrings.install.storeAction })).toBeInTheDocument();
  });

  it('já detectada pula direto para Vincular', () => {
    ext.value = { status: 'detected', loading: false, handshake: { extVersion: '3.0.0' } };
    renderWithTheme(<ExtensionSetupWizard onComplete={vi.fn()} />, 'dark');
    expect(screen.getByText(extensionStrings.wizard.connectTitle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: extensionStrings.install.storeAction })).toBeNull();
  });
});
