import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { ThankYouPage } from '@/pages/ThankYouPage';
import { APP_NAME } from '@/shared/branding/brand';
import { apiClient } from '@/services/apiClient';
import { THANK_YOU_PATH, THANK_YOU_SENDER_EMAIL, THANK_YOU_SUPPORT_URL, thankYouStrings as t } from './strings';

vi.mock('@/components/ThemeModeSelector', () => ({ ThemeModeSelector: () => null }));

let currentSearch = '';
function SearchProbe() {
  currentSearch = useLocation().search;
  return null;
}

const renderAt = (url: string, mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={THANK_YOU_PATH} element={<><ThankYouPage /><SearchProbe /></>} />
        <Route path="/login" element={<p>login</p>} />
      </Routes>
    </MemoryRouter>,
    mode,
  );

afterEach(() => vi.restoreAllMocks());

describe('ThankYouPage', () => {
  it('mostra próximos passos, login e suporte em nova aba', () => {
    renderAt(THANK_YOU_PATH);
    expect(screen.getByRole('heading', { level: 1, name: t.title })).toBeInTheDocument();
    expect(screen.getByText(`<${THANK_YOU_SENDER_EMAIL}>`)).toBeInTheDocument();
    expect(screen.getByText(t.spamTip)).toBeInTheDocument();
    expect(screen.getByText(t.existingBody)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.goToLogin })).toHaveAttribute('href', '/login');
    const support = screen.getByRole('link', { name: new RegExp(t.supportLink) });
    expect(support).toHaveAttribute('href', THANK_YOU_SUPPORT_URL);
    expect(support).toHaveAttribute('target', '_blank');
    expect(support).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(document.title).toBe(`${t.pageTitle} · ${APP_NAME}`);
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex');
  });

  it('ignora a query do checkout: não exibe e limpa da URL, sem chamar a API (tema escuro)', () => {
    const get = vi.spyOn(apiClient, 'get');
    const post = vi.spyOn(apiClient, 'post');
    const { container } = renderAt(`${THANK_YOU_PATH}?email=ana%40x.com&name=Ana%20Silva&order=123`, 'dark');
    expect(container.textContent).not.toMatch(/ana@x\.com|Ana Silva|123/);
    expect(currentSearch).toBe('');
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
