import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { passwordResetService } from '@/services/passwordReset.service';
import { formatServerClock } from '@/features/login-protection/loginProtection';
import { fill } from '@/features/login-protection/strings';
import { FORGOT_PASSWORD_PATH, RESET_PASSWORD_PATH, passwordResetStrings as t } from './strings';

vi.mock('@/components/ThemeModeSelector', () => ({ ThemeModeSelector: () => null }));
vi.mock('@/features/login-protection/useLoginConfig', () => ({
  useLoginConfig: () => ({ siteKey: '', reload: vi.fn() }),
}));

const TOKEN = 'tok-secreto-123';

const renderForgot = (entry: string | { pathname: string; state?: unknown } = FORGOT_PASSWORD_PATH, mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path={FORGOT_PASSWORD_PATH} element={<ForgotPasswordPage />} />
        <Route path="/login" element={<p>tela de login</p>} />
      </Routes>
    </MemoryRouter>,
    mode,
  );

const renderReset = (mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(
    <MemoryRouter initialEntries={[`${RESET_PASSWORD_PATH}/${TOKEN}`]}>
      <Routes>
        <Route path={`${RESET_PASSWORD_PATH}/:token`} element={<ResetPasswordPage />} />
        <Route path={FORGOT_PASSWORD_PATH} element={<p>pedir link</p>} />
        <Route path="/login" element={<p>tela de login</p>} />
      </Routes>
    </MemoryRouter>,
    mode,
  );

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

describe('ForgotPasswordPage', () => {
  it('envia o e-mail e mostra a confirmação neutra, com reenvio em espera', async () => {
    const request = vi.spyOn(passwordResetService, 'request').mockResolvedValue();
    renderForgot();
    const submit = screen.getByRole('button', { name: t.requestSubmit });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText(new RegExp(t.emailLabel)), 'ana@x.com');
    await userEvent.click(submit);

    expect(await screen.findByRole('heading', { name: t.sentTitle })).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith({ email: 'ana@x.com' });
    expect(screen.getByText(t.sentMessage)).toBeInTheDocument();
    expect(screen.getByText(t.sentHint)).toBeInTheDocument();
    expect(screen.queryByText(/ana@x\.com/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.backToLogin })).toHaveAttribute('href', '/login');
    // Reenvio só depois da espera: por ora, a barra no lugar do botão.
    expect(screen.queryByRole('button', { name: t.resend })).not.toBeInTheDocument();
    expect(screen.getByText(t.resendWait)).toBeInTheDocument();
    // Rascunho apagado ao concluir; fica só o passo "enviado" (aba), nunca em localStorage.
    expect(Object.keys(sessionStorage).filter((k) => k.includes('passwordReset'))).toEqual(['ui.passwordReset.sent']);
    expect(JSON.stringify({ ...localStorage })).not.toContain('ana@x.com');
  });

  it('vindo do login com e-mail: abre o formulário, não a confirmação de um pedido anterior da aba', async () => {
    sessionStorage.setItem('ui.passwordReset.sent', JSON.stringify({ v: 0, d: { to: 'antigo@x.com', at: 1 } }));
    renderForgot({ pathname: FORGOT_PASSWORD_PATH, state: { email: 'novo@x.com' } });
    expect(await screen.findByDisplayValue('novo@x.com')).toBeInTheDocument();
    expect(screen.queryByText(t.sentTitle)).not.toBeInTheDocument();
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('antigo@x.com');
  });

  it('reload mantém a confirmação e a espera do reenvio; "Usar outro e-mail" limpa', async () => {
    vi.spyOn(passwordResetService, 'request').mockResolvedValue();
    const first = renderForgot();
    await userEvent.type(screen.getByLabelText(new RegExp(t.emailLabel)), 'ana@x.com');
    await userEvent.click(screen.getByRole('button', { name: t.requestSubmit }));
    expect(await screen.findByText(t.sentTitle)).toBeInTheDocument();
    first.unmount();

    renderForgot();
    expect(screen.getByText(t.sentTitle)).toBeInTheDocument();
    expect(screen.getByText(t.resendWait)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t.useAnotherEmail }));
    expect(screen.queryByText(t.sentTitle)).not.toBeInTheDocument();
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('ana@x.com');
  });

  it('vem do login com o e-mail preenchido (tema escuro)', () => {
    renderForgot({ pathname: FORGOT_PASSWORD_PATH, state: { email: 'bia@x.com' } }, 'dark');
    expect(screen.getByLabelText(new RegExp(t.emailLabel))).toHaveValue('bia@x.com');
    expect(screen.getByRole('button', { name: t.requestSubmit })).toBeEnabled();
  });

  it('429: mostra o horário de liberação e trava o envio', async () => {
    const retryAt = new Date(Date.now() + 30 * 60_000).toISOString();
    vi.spyOn(passwordResetService, 'request').mockRejectedValue({
      code: 'PASSWORD_RESET_TOO_MANY_REQUESTS', status: 429, meta: { retryAt },
    });
    renderForgot({ pathname: FORGOT_PASSWORD_PATH, state: { email: 'ana@x.com' } });
    await userEvent.click(screen.getByRole('button', { name: t.requestSubmit }));

    expect(await screen.findByText(fill(t.tooManyRequests, { time: formatServerClock(retryAt) }))).toBeInTheDocument();
    expect(screen.getByText(t.tooManyRequestsHint)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.requestSubmit })).toBeDisabled();
    expect(screen.queryByText(t.sentTitle)).not.toBeInTheDocument();
  });
});

describe('ResetPasswordPage', () => {
  it('link inválido, vencido ou usado: oferece pedir novo link e ir para o login', async () => {
    vi.spyOn(passwordResetService, 'getInfo').mockRejectedValue({ code: 'PASSWORD_RESET_INVALID', status: 404 });
    renderReset('dark');
    expect(await screen.findByRole('heading', { name: t.invalidTitle })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.requestNewLink })).toHaveAttribute('href', FORGOT_PASSWORD_PATH);
    expect(screen.getByRole('link', { name: t.goToLogin })).toHaveAttribute('href', '/login');
  });

  it('link válido: mascara o e-mail, envia a nova senha e mostra o sucesso com "Fazer login"', async () => {
    vi.spyOn(passwordResetService, 'getInfo').mockResolvedValue({ email: 'mariana@x.com', expiresAt: '2026-12-01T00:00:00.000Z' });
    const reset = vi.spyOn(passwordResetService, 'reset').mockResolvedValue();
    const { baseElement } = renderReset();

    expect(await screen.findByRole('heading', { name: t.resetTitle })).toBeInTheDocument();
    expect(screen.getByText('m*****a@x.com')).toBeInTheDocument();
    expect(screen.queryByText('mariana@x.com')).not.toBeInTheDocument();
    expect(baseElement.textContent).not.toContain(TOKEN);

    const submit = screen.getByRole('button', { name: t.resetSubmit });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(new RegExp(`^${t.passwordLabel}`)), 'Senha-Forte-2026');
    expect(screen.getByText(t.strengthStrong)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(new RegExp(`^${t.confirmPasswordLabel}`)), 'Senha-Forte-2026');
    await userEvent.click(submit);

    expect(await screen.findByRole('heading', { name: t.doneTitle })).toBeInTheDocument();
    expect(reset).toHaveBeenCalledWith(TOKEN, { password: 'Senha-Forte-2026', confirmPassword: 'Senha-Forte-2026' });
    expect(screen.getByRole('link', { name: t.doneLogin })).toHaveAttribute('href', '/login');
    const stored = JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage });
    expect(stored).not.toContain('Senha-Forte-2026');
    expect(stored).not.toContain(TOKEN);
  });

  it('link vencido entre abrir e enviar: cai no estado inválido', async () => {
    vi.spyOn(passwordResetService, 'getInfo').mockResolvedValue({ email: 'ana@x.com', expiresAt: '2026-12-01T00:00:00.000Z' });
    vi.spyOn(passwordResetService, 'reset').mockRejectedValue({ code: 'PASSWORD_RESET_INVALID', status: 404 });
    renderReset();
    await userEvent.type(await screen.findByLabelText(new RegExp(`^${t.passwordLabel}`)), 'Senha-Forte-2026');
    await userEvent.type(screen.getByLabelText(new RegExp(`^${t.confirmPasswordLabel}`)), 'Senha-Forte-2026');
    await userEvent.click(screen.getByRole('button', { name: t.resetSubmit }));
    expect(await screen.findByRole('heading', { name: t.invalidTitle })).toBeInTheDocument();
  });

  it('senha fraca recusada pela API: mensagem no formulário', async () => {
    vi.spyOn(passwordResetService, 'getInfo').mockResolvedValue({ email: 'ana@x.com', expiresAt: '2026-12-01T00:00:00.000Z' });
    vi.spyOn(passwordResetService, 'reset').mockRejectedValue({ code: 'WEAK_PASSWORD', status: 400, message: 'weak' });
    renderReset();
    await userEvent.type(await screen.findByLabelText(new RegExp(`^${t.passwordLabel}`)), 'abcdefgh');
    await userEvent.type(screen.getByLabelText(new RegExp(`^${t.confirmPasswordLabel}`)), 'abcdefgh');
    await userEvent.click(screen.getByRole('button', { name: t.resetSubmit }));
    expect(await screen.findByText(t.weakPassword)).toBeInTheDocument();
  });
});
