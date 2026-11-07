import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StrictMode } from 'react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { extensionStrings } from '@/features/extension/strings';
import { EXTENSION_REMOVED_PATH, EXTENSION_STORE_URL } from '@/features/extension/config';
import { apiClient } from '@/services/apiClient';
import { ExtensionRemovedPage } from './ExtensionRemovedPage';

vi.mock('@/components/ThemeModeSelector', () => ({ ThemeModeSelector: () => null }));
const api = vi.hoisted(() => ({ reportUninstall: vi.fn(), sendUninstallFeedback: vi.fn() }));
vi.mock('@/features/extension/services/extensionApi', async (orig) => {
  const real = await orig<typeof import('@/features/extension/services/extensionApi')>();
  return { ...real, extensionApi: api };
});

const t = extensionStrings.removed;
const ID = '3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b';

const renderAt = (url: string, mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(
    <StrictMode>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path={EXTENSION_REMOVED_PATH} element={<ExtensionRemovedPage />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
    mode,
  );

beforeEach(() => {
  sessionStorage.clear();
  api.reportUninstall.mockReset().mockResolvedValue(undefined);
  api.sendUninstallFeedback.mockReset().mockResolvedValue(undefined);
});

describe('ExtensionRemovedPage', () => {
  it('registra a remoção uma única vez, mesmo com reload na aba', async () => {
    const { unmount } = renderAt(`${EXTENSION_REMOVED_PATH}?i=${ID}&e=abc&v=3.0.0`);
    await waitFor(() => expect(api.reportUninstall).toHaveBeenCalledTimes(1));
    expect(api.reportUninstall).toHaveBeenCalledWith({ installationId: ID, extensionId: 'abc', version: '3.0.0' });
    unmount();
    renderAt(`${EXTENSION_REMOVED_PATH}?i=${ID}`);
    expect(await screen.findByText(t.reasonsLegend)).toBeInTheDocument();
    expect(api.reportUninstall).toHaveBeenCalledTimes(1);
  });

  it('envio exige motivo; envia motivos e comentário e agradece', async () => {
    const post = vi.spyOn(apiClient, 'post');
    renderAt(`${EXTENSION_REMOVED_PATH}?i=${ID}`, 'dark');
    const submit = screen.getByRole('button', { name: t.submit });
    expect(submit).toBeDisabled();
    expect(screen.getByText(t.submitNeedsReason)).toBeInTheDocument();
    expect(screen.getByText(t.commentPrivacy)).toBeInTheDocument();

    const chip = screen.getByRole('button', { name: t.reasons.slow });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText(t.commentLabel), { target: { value: '  pesou  ' } });
    expect(screen.getByText(t.commentCounter(9, 500))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.submit }));

    expect(await screen.findByText(t.thanksTitle)).toBeInTheDocument();
    expect(api.sendUninstallFeedback).toHaveBeenCalledWith({ installationId: ID, reasons: ['slow'], comment: 'pesou' });
    expect(post).not.toHaveBeenCalled();
  });

  it('falha no envio mantém o formulário com aviso', async () => {
    api.sendUninstallFeedback.mockRejectedValueOnce(new Error('x'));
    renderAt(`${EXTENSION_REMOVED_PATH}?i=${ID}`);
    fireEvent.click(screen.getByRole('button', { name: t.reasons.other }));
    fireEvent.click(screen.getByRole('button', { name: t.submit }));
    expect(await screen.findByText(t.submitFailed)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.reasons.other })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sem id válido: só texto e reinstalar, sem chamar a API', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderAt(`${EXTENSION_REMOVED_PATH}?i=nao-uuid`);
    expect(screen.getByText(t.subtitleNoSurvey)).toBeInTheDocument();
    expect(screen.queryByText(t.reasonsLegend)).toBeNull();
    expect(api.reportUninstall).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t.reinstall }));
    expect(open).toHaveBeenCalledWith(EXTENSION_STORE_URL, '_blank', 'noopener');
  });
});
