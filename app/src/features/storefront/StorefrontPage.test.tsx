import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
  deleteStorefront: vi.fn(),
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

  describe('excluir a página', () => {
    const SECRET = 'S3nh@-muito-secreta';
    const withPage = (canDelete?: boolean): StorefrontOverview => ({
      ...overview,
      canDelete,
      publicUrl: 'https://achadinhos.ofertas.test',
      storefront: {
        id: 'p1', title: 'Achadinhos', subtitle: null, avatarUrl: null, coverUrl: null,
        colorPrimary: '#2563EB', colorBackground: '#F5F5F5', colorCard: '#FFFFFF', categories: [],
        status: 'ACTIVE', domainId: 'd1', slug: 'achadinhos',
        createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      },
    });
    const d = t.deletePage;
    const passwordField = () => screen.getByLabelText(d.passwordLabel) as HTMLInputElement;
    const confirmButton = () => screen.getByRole('button', { name: d.confirm });
    const storageDump = () => JSON.stringify([{ ...sessionStorage }, { ...localStorage }]);

    const openDialog = async (mode: 'light' | 'dark' = 'light') => {
      svc.getStorefront.mockResolvedValue(withPage(true));
      renderPage(mode);
      fireEvent.click(await screen.findByRole('button', { name: t.dangerZone.button }));
      await screen.findByRole('dialog');
    };
    const typeAndSend = () => {
      fireEvent.change(passwordField(), { target: { value: SECRET } });
      fireEvent.click(confirmButton());
    };

    beforeEach(() => {
      localStorage.clear();
      svc.deleteStorefront.mockReset();
    });

    it.each([[false], [undefined]])('sem canDelete (%s) não mostra a zona de perigo', async (canDelete) => {
      svc.getStorefront.mockResolvedValue(withPage(canDelete));
      renderPage();
      await screen.findByRole('button', { name: t.config.edit });
      expect(screen.queryByText(t.dangerZone.title)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: t.dangerZone.button })).not.toBeInTheDocument();
    });

    it('sem página criada não mostra a zona de perigo, mesmo com canDelete', async () => {
      svc.getStorefront.mockResolvedValue({ ...overview, canDelete: true });
      renderPage();
      await screen.findByRole('button', { name: t.empty.cta });
      expect(screen.queryByText(t.dangerZone.title)).not.toBeInTheDocument();
    });

    it('diálogo mostra o que será apagado e confirma só com senha digitada', async () => {
      await openDialog('dark');
      expect(within(screen.getByRole('dialog')).getByText('achadinhos.ofertas.test')).toBeInTheDocument();
      expect(screen.getByText(d.addressFreed)).toBeInTheDocument();
      expect(confirmButton()).toBeDisabled();
      expect(passwordField()).toHaveAttribute('type', 'password');
      expect(passwordField()).toHaveAttribute('autocomplete', 'off');
      fireEvent.change(passwordField(), { target: { value: SECRET } });
      expect(confirmButton()).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: d.showPassword }));
      expect(passwordField()).toHaveAttribute('type', 'text');
    });

    it('204: envia a senha, avisa, limpa o rascunho e volta ao estado de criar', async () => {
      svc.getStorefront.mockResolvedValue(withPage(true));
      renderPage();
      // rascunho de edição aberto e persistido antes de excluir
      fireEvent.click(await screen.findByRole('button', { name: t.config.edit }));
      fireEvent.change(screen.getByRole('textbox', { name: new RegExp(t.fields.name.label) }), { target: { value: 'Outro nome' } });
      await waitFor(() => expect(Object.keys(sessionStorage).some((k) => k.includes('storefront.form'))).toBe(true));
      fireEvent.click(screen.getByRole('button', { name: t.dangerZone.button }));
      await screen.findByRole('dialog');

      svc.deleteStorefront.mockResolvedValue(undefined);
      svc.getStorefront.mockResolvedValue({ ...overview, canDelete: true });
      fireEvent.change(passwordField(), { target: { value: SECRET } });
      expect(storageDump()).not.toContain(SECRET);
      fireEvent.submit(passwordField().closest('form')!); // Enter no campo

      expect(await screen.findByText(d.done)).toBeInTheDocument();
      expect(svc.deleteStorefront).toHaveBeenCalledTimes(1);
      expect(svc.deleteStorefront).toHaveBeenCalledWith(SECRET);
      expect(await screen.findByRole('button', { name: t.empty.cta })).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.queryByRole('textbox', { name: new RegExp(t.fields.name.label) })).not.toBeInTheDocument();
      expect(Object.keys(sessionStorage).some((k) => k.includes('storefront.form'))).toBe(false);
      expect(storageDump()).not.toContain(SECRET);
    });

    it('401: mostra senha incorreta, limpa o campo, devolve o foco e não guarda a senha', async () => {
      await openDialog();
      svc.deleteStorefront.mockRejectedValue({ status: 401, code: 'INVALID_CREDENTIALS' });
      typeAndSend();
      expect(await screen.findByText(d.errors.wrongPassword)).toBeInTheDocument();
      expect(passwordField()).toHaveValue('');
      expect(passwordField()).toHaveAttribute('aria-invalid', 'true');
      await waitFor(() => expect(passwordField()).toHaveFocus());
      expect(confirmButton()).toBeDisabled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(storageDump()).not.toContain(SECRET);
    });

    it('429: mostra a espera em minutos e trava o envio', async () => {
      await openDialog();
      svc.deleteStorefront.mockRejectedValue({ status: 429, code: 'PASSWORD_CONFIRMATION_LOCKED', meta: { retryAfterSeconds: 840 } });
      typeAndSend();
      expect(await screen.findByText(d.errors.locked(14))).toBeInTheDocument();
      expect(passwordField()).toBeDisabled();
      expect(passwordField()).toHaveValue('');
      expect(confirmButton()).toBeDisabled();
    });

    it('403: avisa que só administradores podem excluir', async () => {
      await openDialog();
      svc.deleteStorefront.mockRejectedValue({ status: 403, code: 'FORBIDDEN' });
      typeAndSend();
      expect(await screen.findByText(d.errors.forbidden)).toBeInTheDocument();
      expect(passwordField()).toHaveValue('');
    });

    it('erro sem código mostra o texto genérico', async () => {
      await openDialog();
      svc.deleteStorefront.mockRejectedValue(new Error('rede'));
      typeAndSend();
      expect(await screen.findByText(d.errors.generic)).toBeInTheDocument();
    });

    it('404: trata como já excluída e recarrega', async () => {
      await openDialog();
      svc.deleteStorefront.mockRejectedValue({ status: 404, code: 'STOREFRONT_NOT_FOUND' });
      svc.getStorefront.mockResolvedValue({ ...overview, canDelete: true });
      typeAndSend();
      expect(await screen.findByText(d.alreadyDeleted)).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: t.empty.cta })).toBeInTheDocument();
    });

    it('429: fechar e reabrir dentro do bloqueio mantém a espera', async () => {
      await openDialog();
      svc.deleteStorefront.mockRejectedValue({ status: 429, code: 'PASSWORD_CONFIRMATION_LOCKED', meta: { retryAfterSeconds: 840 } });
      typeAndSend();
      await screen.findByText(d.errors.locked(14));
      fireEvent.click(screen.getByRole('button', { name: d.cancel }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: t.dangerZone.button }));
      await screen.findByRole('dialog');
      expect(screen.getByText(d.errors.locked(14))).toBeInTheDocument();
      expect(passwordField()).toBeDisabled();
      expect(confirmButton()).toBeDisabled();
    });

    it.each([
      ['meta.retryAt', { meta: { retryAt: new Date(Date.now() + 300_000).toISOString() }, retryAfter: '600' }, 5],
      ['header Retry-After', { retryAfter: '120' }, 2],
      ['nada (15 min)', {}, 15],
    ])('429 sem retryAfterSeconds usa %s', async (_label, extra, minutes) => {
      await openDialog();
      svc.deleteStorefront.mockRejectedValue({ status: 429, code: 'PASSWORD_CONFIRMATION_LOCKED', ...extra });
      typeAndSend();
      expect(await screen.findByText(d.errors.locked(minutes))).toBeInTheDocument();
      expect(passwordField()).toBeDisabled();
    });

    it('204: durante o recarregamento a página antiga some e Editar não ressuscita o rascunho', async () => {
      await openDialog();
      svc.deleteStorefront.mockResolvedValue(undefined);
      let finishReload!: (o: StorefrontOverview) => void;
      svc.getStorefront.mockReturnValue(new Promise<StorefrontOverview>((r) => { finishReload = r; }));
      typeAndSend();
      await screen.findByText(d.done);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      // recarregando: quem clicar em Editar (se ainda estiver na tela) regravaria o rascunho da página excluída
      const edit = screen.queryByRole('button', { name: t.config.edit });
      if (edit) fireEvent.click(edit);
      expect(edit).toBeNull();
      finishReload({ ...overview, canDelete: true });
      expect(await screen.findByRole('button', { name: t.empty.cta })).toBeInTheDocument();
      expect(Object.keys(sessionStorage).some((k) => k.includes('storefront.form'))).toBe(false);
    });

    describe('plano sem a página (planLocked)', () => {
      const locked = (canDelete: boolean): StorefrontOverview => {
        const base = withPage(canDelete);
        return { ...base, planLocked: true, categories: [], domains: [], storefront: { ...base.storefront!, status: 'PAUSED_BY_PLAN', offersCount: 7 } };
      };

      it('admin vê o aviso de plano e a exclusão, sem edição nem ofertas', async () => {
        svc.getStorefront.mockResolvedValue(locked(true));
        renderPage('dark');
        expect(await screen.findByText(t.page.paused)).toBeInTheDocument();
        expect(screen.queryByText('tela de planos')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: t.config.edit })).not.toBeInTheDocument();
        expect(screen.queryByText(t.addOffer.title)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: t.dangerZone.button }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(d.offersItem(7))).toBeInTheDocument();
        svc.deleteStorefront.mockResolvedValue(undefined);
        svc.getStorefront.mockRejectedValue({ status: 403, code: 'PLAN_FEATURE_UNAVAILABLE' });
        typeAndSend();
        await waitFor(() => expect(svc.deleteStorefront).toHaveBeenCalledWith(SECRET));
        expect(await screen.findByText('tela de planos')).toBeInTheDocument();
      });

      it('"Ver planos" leva à tela de planos', async () => {
        svc.getStorefront.mockResolvedValue(locked(true));
        renderPage();
        fireEvent.click(await screen.findByRole('link', { name: t.page.seePlans }));
        expect(await screen.findByText('tela de planos')).toBeInTheDocument();
      });

      it('sem canDelete mostra só o aviso de plano', async () => {
        svc.getStorefront.mockResolvedValue(locked(false));
        renderPage();
        expect(await screen.findByText(t.page.paused)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: t.dangerZone.button })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: t.config.edit })).not.toBeInTheDocument();
      });
    });

    it('cancelar fecha e reabrir vem com o campo vazio', async () => {
      await openDialog();
      fireEvent.change(passwordField(), { target: { value: SECRET } });
      fireEvent.click(screen.getByRole('button', { name: d.cancel }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: t.dangerZone.button }));
      await screen.findByRole('dialog');
      expect(passwordField()).toHaveValue('');
      expect(svc.deleteStorefront).not.toHaveBeenCalled();
    });
  });

  it('sem plano com chave storefront_enabled redireciona', async () => {
    svc.getStorefront.mockRejectedValue({ status: 403, code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: 'storefront_enabled' } });
    renderPage();
    expect(await screen.findByText('tela de planos')).toBeInTheDocument();
  });
});
