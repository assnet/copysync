import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import type { StorefrontOverview } from './types';
import { storefrontStrings as t } from './strings';
import { affiliateLinkStrings } from '@/features/affiliateLinks/strings';

const svc = vi.hoisted(() => ({
  getStorefront: vi.fn(),
  checkSlug: vi.fn(() => new Promise<never>(() => {})),
  saveStorefront: vi.fn(),
  extractOffer: vi.fn(),
  preview: vi.fn(() => new Promise<string>(() => {})),
}));
vi.mock('@/services/storefront.service', () => ({ storefrontService: svc }));

import { StorefrontPage } from './StorefrontPage';

const overview: StorefrontOverview = {
  storefront: null,
  publicUrl: null,
  offers: { drafts: [], published: [] },
  categories: [{ key: 'casa', label: 'Casa' }],
  subtitleSuggestions: [],
  domains: [{ id: 'd1', hostname: 'ofertas.test' }],
};

const renderPage = (mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(
    <MemoryRouter initialEntries={['/storefront']}>
      <PrivacyProvider>
        <Routes>
          <Route path="/storefront" element={<StorefrontPage />} />
          <Route path="/affiliates/plans" element={<p>tela de planos</p>} />
        </Routes>
      </PrivacyProvider>
    </MemoryRouter>,
    mode,
  );

describe('StorefrontPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.values(svc).forEach((f) => f.mockClear());
    svc.getStorefront.mockReset();
  });

  it('sem plano (PLAN_FEATURE_UNAVAILABLE) redireciona para os planos', async () => {
    svc.getStorefront.mockRejectedValue({ status: 403, code: 'PLAN_FEATURE_UNAVAILABLE' });
    renderPage();
    expect(await screen.findByText('tela de planos')).toBeInTheDocument();
  });

  it('PLAN_LIMIT_REACHED não redireciona: mostra erro com tentar de novo', async () => {
    svc.getStorefront.mockRejectedValue({ status: 403, code: 'PLAN_LIMIT_REACHED' });
    renderPage('dark');
    expect(await screen.findByText(t.page.loadError)).toBeInTheDocument();
    expect(screen.queryByText('tela de planos')).not.toBeInTheDocument();
    svc.getStorefront.mockResolvedValue(overview);
    fireEvent.click(screen.getByRole('button', { name: t.page.retry }));
    expect(await screen.findByRole('button', { name: t.empty.cta })).toBeInTheDocument();
  });

  it('criar abre o formulário e o rascunho sobrevive ao recarregar', async () => {
    svc.getStorefront.mockResolvedValue(overview);
    const first = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: t.empty.cta }));
    fireEvent.change(screen.getByRole('textbox', { name: new RegExp(t.fields.name.label) }), { target: { value: 'Achadinhos' } });
    first.unmount();
    renderPage();
    await waitFor(() => expect(screen.getByRole('textbox', { name: new RegExp(t.fields.name.label) })).toHaveValue('Achadinhos'));
    // o subdomínio acompanhou o nome (não foi editado)
    expect(screen.getByRole('textbox', { name: new RegExp(t.fields.subdomain.label) })).toHaveValue('achadinhos');
  });

  it('reload com rascunho igual ao salvo sai do modo editar e limpa a chave', async () => {
    const created: StorefrontOverview = {
      ...overview,
      publicUrl: 'https://achadinhos.ofertas.test',
      storefront: {
        id: 'p1', title: 'Achadinhos', subtitle: null, avatarUrl: null, coverUrl: null,
        colorPrimary: '#2563EB', colorBackground: '#F5F5F5', colorCard: '#FFFFFF', categories: [],
        status: 'ACTIVE', domainId: 'd1', slug: 'achadinhos',
        createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      },
    };
    svc.getStorefront.mockResolvedValue(created);
    const first = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: t.config.edit }));
    expect(screen.getByRole('textbox', { name: new RegExp(t.fields.name.label) })).toBeInTheDocument();
    first.unmount();
    renderPage();
    expect(await screen.findByRole('button', { name: t.config.edit })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: new RegExp(t.fields.name.label) })).not.toBeInTheDocument();
    expect(Object.keys(sessionStorage).some((k) => k.includes('storefront.form'))).toBe(false);
  });
  describe('extrair oferta: 403 de outro recurso', () => {
    const withPage: StorefrontOverview = {
      ...overview,
      publicUrl: 'https://achadinhos.ofertas.test',
      storefront: {
        id: 'p1', title: 'Achadinhos', subtitle: null, avatarUrl: null, coverUrl: null,
        colorPrimary: '#2563EB', colorBackground: '#F5F5F5', colorCard: '#FFFFFF', categories: [],
        status: 'ACTIVE', domainId: 'd1', slug: 'achadinhos',
        createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      },
    };
    const extract = async (err: unknown) => {
      svc.getStorefront.mockResolvedValue(withPage);
      svc.extractOffer.mockReset();
      svc.extractOffer.mockRejectedValue(err);
      renderPage();
      const field = await screen.findByRole('textbox', { name: new RegExp(t.addOffer.urlLabel) });
      fireEvent.change(field, { target: { value: 'https://br.shein.com/p-1.html' } });
      fireEvent.click(screen.getByRole('button', { name: t.addOffer.extract }));
      await waitFor(() => expect(svc.extractOffer).toHaveBeenCalled());
    };

    it('Shein fora do plano não redireciona e mostra o texto no campo', async () => {
      await extract({ status: 403, code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: 'marketplace_shein_enabled' } });
      expect(await screen.findByText(t.errors.sheinUnavailable)).toBeInTheDocument();
      expect(screen.queryByText('tela de planos')).not.toBeInTheDocument();
    });

    it('aceite da Shein pendente mostra o texto no campo', async () => {
      await extract({ status: 403, code: 'MARKETPLACE_RISK_NOT_ACCEPTED' });
      expect(await screen.findByText(affiliateLinkStrings.errors.riskNotAccepted)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: affiliateLinkStrings.actions.openCredentials })).toBeInTheDocument();
    });

    it('sem credencial da loja mostra o texto e "Conectar <loja>" no campo', async () => {
      await extract({ status: 422, code: 'AFFILIATE_CREDENTIAL_REQUIRED', meta: { provider: 'SHOPEE' } });
      expect(await screen.findByText(affiliateLinkStrings.errors.credentialRequired('SHOPEE'))).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Conectar Shopee' })).toHaveAttribute('href', '/affiliates/credentials?returnTo=%2Fstorefront');
    });

    it('item criado com link recriado mostra o aviso no card', async () => {
      svc.getStorefront.mockResolvedValue(withPage);
      svc.extractOffer.mockReset();
      svc.extractOffer.mockResolvedValue({
        id: 'o1', status: 'DRAFT', position: 0, provider: 'MERCADO_LIVRE', sourceUrl: 'https://x.test/p', affiliateUrl: 'https://x.test/a',
        attributionVerified: true, title: 'Produto', priceCents: null, originalPriceCents: null, imageUrl: null, category: null,
        publishedAt: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', linkRebuilt: true,
      });
      renderPage();
      const field = await screen.findByRole('textbox', { name: new RegExp(t.addOffer.urlLabel) });
      fireEvent.change(field, { target: { value: 'https://produto.mercadolivre.com.br/MLB-1' } });
      fireEvent.click(screen.getByRole('button', { name: t.addOffer.extract }));
      expect(await screen.findByText('Link recriado com a sua conta do Mercado Livre')).toBeInTheDocument();
    });

    it('Página de Ofertas fora do plano continua redirecionando', async () => {
      await extract({ status: 403, code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: 'storefront_enabled' } });
      expect(await screen.findByText('tela de planos')).toBeInTheDocument();
    });
  });

  it('sem plano com chave storefront_enabled redireciona', async () => {
    svc.getStorefront.mockRejectedValue({ status: 403, code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: 'storefront_enabled' } });
    renderPage();
    expect(await screen.findByText('tela de planos')).toBeInTheDocument();
  });
});
