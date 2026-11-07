import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { RedirectPage, redirectNavigator } from '@/pages/RedirectPage';
import { publicRedirectService } from '@/services/publicRedirect.service';
import { redirectLinksStrings } from './strings';

const t = redirectLinksStrings.public;

afterEach(() => vi.restoreAllMocks());

const renderAt = (slug: string, mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(
    <MemoryRouter initialEntries={[`/redirect/${slug}`]}>
      <Routes>
        <Route path="/redirect/:slug" element={<RedirectPage />} />
      </Routes>
    </MemoryRouter>,
    mode,
  );

describe('RedirectPage', () => {
  it('resolve o slug e troca a página com location.replace', async () => {
    const resolve = vi.spyOn(publicRedirectService, 'resolve').mockResolvedValue('https://chromewebstore.google.com/x');
    const replace = vi.spyOn(redirectNavigator, 'replace').mockImplementation(() => undefined);
    renderAt('chrome-web-store-v5.235.2');
    expect(screen.getByText(t.redirecting, { selector: 'h1' })).toBeInTheDocument();
    expect(await screen.findByText(t.manualLink)).toHaveAttribute('href', 'https://chromewebstore.google.com/x');
    expect(resolve).toHaveBeenCalledWith('chrome-web-store-v5.235.2');
    expect(replace).toHaveBeenCalledWith('https://chromewebstore.google.com/x');
  });

  it('nunca segue destino que não é https', async () => {
    vi.spyOn(publicRedirectService, 'resolve').mockResolvedValue('javascript:alert(1)');
    const replace = vi.spyOn(redirectNavigator, 'replace').mockImplementation(() => undefined);
    renderAt('x');
    expect(await screen.findByText(t.unavailableTitle)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('404 mostra link indisponível (tema escuro)', async () => {
    vi.spyOn(publicRedirectService, 'resolve').mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    renderAt('sumiu', 'dark');
    expect(await screen.findByText(t.unavailableTitle)).toBeInTheDocument();
    expect(screen.getByText(t.unavailableHint)).toBeInTheDocument();
  });

  it('falha de rede oferece tentar de novo', async () => {
    const resolve = vi.spyOn(publicRedirectService, 'resolve').mockRejectedValueOnce(new Error('net'));
    renderAt('loja');
    const retry = await screen.findByRole('button', { name: t.retry });
    resolve.mockResolvedValueOnce('https://a.com');
    vi.spyOn(redirectNavigator, 'replace').mockImplementation(() => undefined);
    await userEvent.click(retry);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
