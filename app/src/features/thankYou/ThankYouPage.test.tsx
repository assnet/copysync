import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, type Location } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { ThankYouPage } from '@/pages/ThankYouPage';
import { APP_NAME } from '@/shared/branding/brand';
import { apiClient } from '@/services/apiClient';
import {
  THANK_YOU_FROM_LOGIN_STATE, THANK_YOU_MAIL_SHORTCUTS, THANK_YOU_PATH, THANK_YOU_SENDER_EMAIL, THANK_YOU_SUPPORT_URL,
  thankYouStrings as t,
} from './strings';

vi.mock('@/components/ThemeModeSelector', () => ({ ThemeModeSelector: () => null }));

let current: Location | undefined;
function LocationProbe() {
  current = useLocation();
  return null;
}

type Entry = string | { pathname: string; search?: string; hash?: string; state?: unknown };

const renderAt = (entry: Entry, mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path={THANK_YOU_PATH} element={<><ThankYouPage /><LocationProbe /></>} />
        <Route path="/login" element={<p>login</p>} />
      </Routes>
    </MemoryRouter>,
    mode,
  );

afterEach(() => { vi.restoreAllMocks(); current = undefined; });

describe('ThankYouPage', () => {
  it('variante padrão (checkout): compra confirmada, 3 passos, remetente e login secundário', () => {
    renderAt(THANK_YOU_PATH);
    const v = t.variants.purchase;
    expect(screen.getByRole('heading', { level: 1, name: v.title })).toBeInTheDocument();
    expect(screen.getByText(v.badge)).toBeInTheDocument();
    expect(document.title).toBe(`${v.pageTitle} · ${APP_NAME}`);

    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
    expect(screen.getByRole('heading', { level: 3, name: new RegExp(t.steps.setPassword.title) })).toBeInTheDocument();
    const sender = screen.getByTestId('thank-you-sender');
    expect(within(sender).getByText(THANK_YOU_SENDER_EMAIL)).toBeInTheDocument();
    expect(within(sender).getByText(APP_NAME)).toBeInTheDocument();
    expect(screen.getByText(t.spamTip)).toBeInTheDocument();
    expect(screen.getByText(t.existingBody.purchase)).toBeInTheDocument();

    const login = screen.getByRole('link', { name: t.goToLogin.purchase });
    expect(login).toHaveAttribute('href', '/login');
    expect(login.className).toContain('MuiButton-outlined');
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex');
  });

  it('atalhos de e-mail abrem em nova aba, só https', () => {
    renderAt(THANK_YOU_PATH);
    for (const shortcut of THANK_YOU_MAIL_SHORTCUTS) {
      const link = screen.getByRole('link', { name: shortcut.label });
      expect(link.getAttribute('href')).toMatch(/^https:\/\//);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    }
  });

  it('suporte usa o atalho relativo de redirecionamento, em nova aba', () => {
    renderAt(THANK_YOU_PATH);
    expect(THANK_YOU_SUPPORT_URL).toBe('/redirect/suporte');
    const support = screen.getByRole('link', { name: new RegExp(t.supportLink) });
    expect(support).toHaveAttribute('href', THANK_YOU_SUPPORT_URL);
    expect(support).toHaveAttribute('target', '_blank');
    expect(support).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('variante primeiro acesso (state do login): não afirma pagamento, mesmos passos', () => {
    renderAt({ pathname: THANK_YOU_PATH, state: THANK_YOU_FROM_LOGIN_STATE });
    const v = t.variants.firstAccess;
    expect(screen.getByRole('heading', { level: 1, name: v.title })).toBeInTheDocument();
    expect(screen.getByText(v.subtitle)).toBeInTheDocument();
    expect(screen.queryByText(t.variants.purchase.badge)).not.toBeInTheDocument();
    expect(screen.queryByText(t.variants.purchase.title)).not.toBeInTheDocument();
    expect(document.title).toBe(`${v.pageTitle} · ${APP_NAME}`);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
    expect(screen.getByText(THANK_YOU_SENDER_EMAIL)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.goToLogin.firstAccess })).toHaveAttribute('href', '/login');
  });

  it.each([
    ['string', 'login'], ['from desconhecido', { from: 'checkout' }], ['from não string', { from: { a: 1 } }],
    ['array', ['login']], ['null', null],
  ])('state inválido (%s) cai na variante padrão', (_label, state) => {
    renderAt({ pathname: THANK_YOU_PATH, state });
    expect(screen.getByRole('heading', { level: 1, name: t.variants.purchase.title })).toBeInTheDocument();
  });

  it('ignora a query do checkout: não exibe e limpa da URL, sem chamar a API (tema escuro)', () => {
    const get = vi.spyOn(apiClient, 'get');
    const post = vi.spyOn(apiClient, 'post');
    const { container } = renderAt(`${THANK_YOU_PATH}?email=ana%40x.com&name=Ana%20Silva&order=123`, 'dark');
    expect(container.textContent).not.toMatch(/ana@x\.com|Ana Silva|123/);
    expect(current?.search).toBe('');
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('limpa query e hash preservando o state de primeiro acesso', () => {
    renderAt({ pathname: THANK_YOU_PATH, search: '?email=ana%40x.com', hash: '#x', state: THANK_YOU_FROM_LOGIN_STATE });
    expect(current?.search).toBe('');
    expect(current?.hash).toBe('');
    expect(current?.state).toEqual(THANK_YOU_FROM_LOGIN_STATE);
    expect(screen.getByRole('heading', { level: 1, name: t.variants.firstAccess.title })).toBeInTheDocument();
  });
});
