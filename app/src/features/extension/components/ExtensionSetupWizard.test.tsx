import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { extensionStrings } from '../strings';
import { ExtensionSetupWizard } from './ExtensionSetupWizard';

const ext = vi.hoisted(() => ({ value: { status: 'not_detected', loading: false } as Record<string, unknown> }));
vi.mock('../hooks/useExtension', () => ({
  useExtension: () => ({ refresh: vi.fn(), handshake: null, mlStatus: null, ...ext.value }),
  syncErrorMessage: () => '',
}));
vi.mock('../config', async (orig) => ({ ...(await orig<typeof import('../config')>()), isChromiumDesktop: () => true, isExtensionCapableBrowser: () => true }));
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
  it('ML (regressão): pede consentimento, vincula com ele e sincroniza o ML', async () => {
    const user = userEvent.setup();
    const connect = vi.fn().mockResolvedValue(undefined);
    const syncMl = vi.fn().mockResolvedValue({ result: 'UPDATED' });
    ext.value = {
      status: 'detected', loading: false, handshake: { extVersion: '3.4.0', installationId: 'inst-1' }, connect, syncMl,
    };
    renderWithTheme(<ExtensionSetupWizard source="ml_wizard" marketplace="ml" onComplete={vi.fn()} />);

    const link = screen.getByRole('button', { name: extensionStrings.wizard.connectAction });
    expect(link).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: extensionStrings.wizard.connectConsent }));
    await user.click(link);
    expect(connect).toHaveBeenCalledWith('inst-1', '3.4.0', true);

    await user.click(await screen.findByRole('button', { name: extensionStrings.wizard.syncAction }));
    await waitFor(() => expect(syncMl).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(extensionStrings.wizard.doneTitle)).toBeInTheDocument();
  });

  it('sync com vínculo de outra instalação (404 SESSION_NOT_FOUND) volta para Vincular com aviso', async () => {
    const user = userEvent.setup();
    const syncMl = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'SESSION_NOT_FOUND' }));
    ext.value = { status: 'connected', loading: false, handshake: { extVersion: '3.4.0', installationId: 'inst-2' }, syncMl };
    renderWithTheme(<ExtensionSetupWizard source="ml_wizard" marketplace="ml" onComplete={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: extensionStrings.wizard.syncAction }));
    expect(await screen.findByText(extensionStrings.errors.relinkRequired)).toBeInTheDocument();
    expect(screen.getByText(extensionStrings.wizard.connectTitle)).toBeInTheDocument();
  });

  it('pular o sync depois de erro: Pronto sem o erro e sem prometer renovação automática', async () => {
    const user = userEvent.setup();
    const syncMl = vi.fn().mockRejectedValue(new Error('x'));
    ext.value = { status: 'connected', loading: false, handshake: { extVersion: '3.4.0', installationId: 'inst-1' }, syncMl };
    renderWithTheme(<ExtensionSetupWizard source="ml_wizard" marketplace="ml" onComplete={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: extensionStrings.wizard.syncAction }));
    await waitFor(() => expect(syncMl).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: extensionStrings.wizard.syncSkip }));
    expect(await screen.findByText(extensionStrings.wizard.doneHintNotSynced)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Shein: só vincula, sem consentimento do ML nem sync', async () => {
    const user = userEvent.setup();
    const connect = vi.fn().mockResolvedValue(undefined);
    const syncMl = vi.fn();
    ext.value = {
      status: 'detected', loading: false, handshake: { extVersion: '3.4.0', installationId: 'inst-1' }, connect, syncMl,
    };
    renderWithTheme(<ExtensionSetupWizard marketplace="shein" onComplete={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: extensionStrings.wizard.connectAction }));
    expect(connect).toHaveBeenCalledWith('inst-1', '3.4.0', false);
    expect(await screen.findByText(extensionStrings.wizard.doneTitle)).toBeInTheDocument();
    expect(syncMl).not.toHaveBeenCalled();
  });
});
