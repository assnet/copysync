import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import { AdminRedirectLinksPage } from '@/pages/admin/AdminRedirectLinksPage';
import { adminRedirectLinksService } from '@/services/adminRedirectLinks.service';
import { redirectLinksStrings as t } from './strings';
import type { RedirectLink } from './types';

const at = '2026-11-07T12:00:00.000Z';
const link = (over: Partial<RedirectLink> = {}): RedirectLink => ({
  id: 'r1', slug: 'loja', urlA: 'https://a.com/', urlB: 'https://b.com/', percentA: 70, isActive: true,
  hitsA: 7, hitsB: 3, hitsTotal: 10, note: null, createdAt: at, updatedAt: at, ...over,
});

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('AdminRedirectLinksPage', () => {
  it('vazia: estado vazio com ação de criar', async () => {
    vi.spyOn(adminRedirectLinksService, 'list').mockResolvedValue([]);
    renderWithTheme(<AdminRedirectLinksPage />);
    expect(await screen.findByText(t.empty)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.add })).toBeInTheDocument();
  });

  it('lista: link completo, divisão, cliques A/B e total (tema escuro)', async () => {
    vi.spyOn(adminRedirectLinksService, 'list').mockResolvedValue([link()]);
    renderWithTheme(<AdminRedirectLinksPage />, 'dark');
    const row = (await screen.findByText('loja')).closest('tr')!;
    expect(within(row).getByText(`${window.location.origin}/redirect/loja`)).toBeInTheDocument();
    expect(within(row).getByText(t.splitLabel(70))).toBeInTheDocument();
    expect(within(row).getByText(t.clicksSplit(7, 3))).toBeInTheDocument();
    expect(within(row).getByText('10')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: `${t.actions.open}: loja` })).toHaveAttribute('target', '_blank');
  });

  it('erro na 1ª carga mostra alerta com tentar de novo', async () => {
    vi.spyOn(adminRedirectLinksService, 'list').mockRejectedValue(Object.assign(new Error('x'), { code: 'UNAUTHORIZED' }));
    renderWithTheme(<AdminRedirectLinksPage />);
    expect(await screen.findByText(t.errors.UNAUTHORIZED)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.retry })).toBeInTheDocument();
  });

  it('criar: valida https antes de enviar e envia normalizado', async () => {
    vi.spyOn(adminRedirectLinksService, 'list').mockResolvedValue([]);
    const create = vi.spyOn(adminRedirectLinksService, 'create').mockResolvedValue(link({ id: 'r2', slug: 'suporte', urlB: null, percentA: 100 }));
    const user = userEvent.setup();
    renderWithTheme(<AdminRedirectLinksPage />);
    await user.click(await screen.findByRole('button', { name: t.add }));
    await user.type(screen.getByRole('textbox', { name: new RegExp(t.form.slug) }), 'Suporte');
    await user.type(screen.getByRole('textbox', { name: new RegExp(t.form.urlA) }), 'http://wa.me/55');
    await user.click(screen.getByRole('button', { name: t.form.create }));
    expect(screen.getByText(t.form.urlInvalid)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    const urlA = screen.getByRole('textbox', { name: new RegExp(t.form.urlA) });
    await user.clear(urlA);
    await user.type(urlA, 'https://wa.me/55');
    await user.click(screen.getByRole('button', { name: t.form.create }));
    expect(create).toHaveBeenCalledWith({ slug: 'suporte', urlA: 'https://wa.me/55', urlB: null, isActive: true, note: null });
    expect(await screen.findByText('suporte')).toBeInTheDocument();
  });

  it('editar slug avisa que o antigo para de funcionar', async () => {
    vi.spyOn(adminRedirectLinksService, 'list').mockResolvedValue([link()]);
    const user = userEvent.setup();
    renderWithTheme(<AdminRedirectLinksPage />);
    await user.click(await screen.findByRole('button', { name: `${t.actions.edit}: loja` }));
    const slug = screen.getByRole('textbox', { name: new RegExp(t.form.slug) });
    await user.clear(slug);
    await user.type(slug, 'loja-v2');
    expect(screen.getByText(t.form.slugChangeWarning)).toBeInTheDocument();
  });

  it('apagar pede confirmação', async () => {
    vi.spyOn(adminRedirectLinksService, 'list').mockResolvedValue([link()]);
    const remove = vi.spyOn(adminRedirectLinksService, 'remove').mockResolvedValue();
    const user = userEvent.setup();
    renderWithTheme(<AdminRedirectLinksPage />);
    await user.click(await screen.findByRole('button', { name: `${t.actions.remove}: loja` }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: t.removeDialog.confirm }));
    expect(remove).toHaveBeenCalledWith('r1');
  });
});
