import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { LoginPage } from '@/pages/LoginPage';
import { APP_NAME } from '@/shared/branding/brand';
import { BUY_NOW_PATH, INTRO_VIDEO_EMBED_URL, INTRO_VIDEO_POSTERS } from '@/features/platformLinks/links';
import { THANK_YOU_PATH } from '@/features/thankYou/strings';
import { FORGOT_PASSWORD_PATH, passwordResetStrings } from '@/features/passwordReset/strings';
import { LoginIntroVideo } from './LoginIntroVideo';
import { LOGIN_COPY } from './loginContent';

vi.mock('@/components/ThemeModeSelector', () => ({ ThemeModeSelector: () => null }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ login: vi.fn(), verifyLoginCode: vi.fn() }) }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ loadTenants: vi.fn() }) }));
vi.mock('@/features/login-protection/useLoginConfig', () => ({
  useLoginConfig: () => ({ siteKey: null, reload: vi.fn() }),
}));
vi.mock('./LoginAmbientVideo', () => ({ LoginAmbientVideo: () => null }));

function FirstAccessProbe() {
  const from = (useLocation().state as { from?: string } | null)?.from;
  return <p>destino:{from}</p>;
}

function ForgotProbe() {
  const email = (useLocation().state as { email?: string } | null)?.email;
  return <p>esqueci:{email ?? 'vazio'}</p>;
}

const renderLogin = (mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path={THANK_YOU_PATH} element={<FirstAccessProbe />} />
        <Route path={FORGOT_PASSWORD_PATH} element={<ForgotProbe />} />
      </Routes>
    </MemoryRouter>,
    mode,
  );

describe('LoginPage', () => {
  it('mantém o formulário e oferece "Comprar agora" em nova aba pelo link de redirecionamento', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: LOGIN_COPY.form.submit })).toBeDisabled();
    expect(screen.getByText(LOGIN_COPY.buy.title)).toBeInTheDocument();
    const buy = screen.getByRole('link', { name: LOGIN_COPY.buy.cta });
    expect(buy).toHaveAttribute('href', BUY_NOW_PATH);
    expect(buy).toHaveAttribute('target', '_blank');
    expect(buy).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('leva "Meu primeiro acesso" à página de primeiro acesso com a origem no state (tema escuro)', async () => {
    renderLogin('dark');
    expect(screen.getByText(LOGIN_COPY.firstAccess.prompt)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: LOGIN_COPY.firstAccess.link });
    expect(link).toHaveAttribute('href', THANK_YOU_PATH);
    await userEvent.click(link);
    expect(screen.getByText('destino:login')).toBeInTheDocument();
  });

  it('"Esqueci minha senha" leva ao pedido do link com o e-mail digitado', async () => {
    renderLogin();
    await userEvent.type(screen.getByLabelText(new RegExp(LOGIN_COPY.form.email)), 'ana@x.com');
    const link = screen.getByRole('link', { name: passwordResetStrings.forgotLink });
    expect(link).toHaveAttribute('href', FORGOT_PASSWORD_PATH);
    await userEvent.click(link);
    expect(screen.getByText('esqueci:ana@x.com')).toBeInTheDocument();
  });

  it('"Esqueci minha senha" sem e-mail digitado não leva state', async () => {
    renderLogin('dark');
    await userEvent.click(screen.getByRole('link', { name: passwordResetStrings.forgotLink }));
    expect(screen.getByText('esqueci:vazio')).toBeInTheDocument();
  });

  it('não carrega o player antes do clique em nenhuma das fachadas (desktop e mobile)', () => {
    const { baseElement } = renderLogin();
    expect(screen.getAllByRole('button', { name: LOGIN_COPY.introVideo.playLabel })).toHaveLength(2);
    expect(baseElement.querySelector('iframe')).toBeNull();
    expect(baseElement.querySelector('script[src*="youtube"]')).toBeNull();
  });
});

describe('LoginIntroVideo', () => {
  const frameTitle = LOGIN_COPY.introVideo.frameTitle(APP_NAME);

  it.each(['card', 'compact'] as const)('%s: mostra só a capa e monta o iframe após o play', async (variant) => {
    const { baseElement } = renderWithTheme(<LoginIntroVideo variant={variant} />);
    const poster = baseElement.querySelector('img');
    expect(poster).toHaveAttribute('src', INTRO_VIDEO_POSTERS[0]);
    expect(baseElement.querySelector('iframe')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: LOGIN_COPY.introVideo.playLabel }));

    const dialog = screen.getByRole('dialog', { name: LOGIN_COPY.introVideo.dialogTitle });
    const frame = within(dialog).getByTitle(frameTitle);
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', INTRO_VIDEO_EMBED_URL);
    expect(frame).toHaveAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
    expect(frame).toHaveAttribute('loading', 'lazy');
    expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    expect(baseElement.querySelector('script[src*="youtube"]')).toBeNull();
  });

  it('cai na capa reserva se a de alta resolução falhar e fecha desmontando o player', async () => {
    const { baseElement } = renderWithTheme(<LoginIntroVideo variant="card" />, 'dark');
    const poster = baseElement.querySelector('img')!;
    poster.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(baseElement.querySelector('img')).toHaveAttribute('src', INTRO_VIDEO_POSTERS[1]));

    await userEvent.click(screen.getByRole('button', { name: LOGIN_COPY.introVideo.playLabel }));
    expect(screen.getByTitle(frameTitle)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: LOGIN_COPY.introVideo.close }));
    await vi.waitFor(() => expect(baseElement.querySelector('iframe')).toBeNull());
  });
});
