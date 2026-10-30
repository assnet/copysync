import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import { offerStoryStrings as t } from './strings';

const svc = vi.hoisted(() => ({ listTemplates: vi.fn(), render: vi.fn() }));
vi.mock('@/services/offerStory.service', () => ({ offerStoryService: svc }));

import { OfferStoryPage } from './OfferStoryPage';

const renderPage = (mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(
    <MemoryRouter initialEntries={['/offer-story']}>
      <PrivacyProvider>
        <Routes>
          <Route path="/offer-story" element={<OfferStoryPage />} />
          <Route path="/plans" element={<p>tela de planos</p>} />
        </Routes>
      </PrivacyProvider>
    </MemoryRouter>,
    mode,
  );

describe('OfferStoryPage', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); svc.listTemplates.mockReset(); svc.render.mockReset(); });

  it('sem plano cai em /plans', async () => {
    svc.listTemplates.mockRejectedValue({ status: 403, code: 'PLAN_FEATURE_UNAVAILABLE' });
    renderPage();
    expect(await screen.findByText('tela de planos')).toBeTruthy();
  });

  it('passa pelos 3 passos (escuro)', async () => {
    svc.listTemplates.mockResolvedValue([{ id: 'flash-night', name: 'Oferta relâmpago' }]);
    svc.render.mockResolvedValue({
      image: 'data:image/jpeg;base64,AAAA', width: 1080, height: 1920, templateId: 'flash-night', headline: 'Fone',
      provider: 'SHOPEE', affiliateUrl: 'https://s.shopee.com.br/x', attributionVerified: false,
      price: { fromCents: null, toCents: null }, coupon: null, warnings: ['NO_PRICE'],
    });
    renderPage('dark');
    const continueBtn = await screen.findByRole('button', { name: t.template.continue });
    expect((continueBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Oferta relâmpago' }));
    fireEvent.click(continueBtn);
    fireEvent.change(screen.getByLabelText(new RegExp(t.product.linkLabel)), { target: { value: 'https://shopee.com.br/p-i.1.2' } });
    fireEvent.click(screen.getByRole('button', { name: t.product.generate }));
    expect(await screen.findByText(t.result.title)).toBeTruthy();
    expect(screen.getByText(t.result.unverified)).toBeTruthy();
    expect(screen.getByText(t.result.warnings.NO_PRICE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.result.share })).toBeNull();
    expect(screen.getByRole('button', { name: t.result.copyLink })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t.result.newArt }));
    await waitFor(() => expect(screen.getByRole('button', { name: t.template.continue })).toBeTruthy());
  });
});
