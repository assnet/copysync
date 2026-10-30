import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { storefrontStrings } from '../strings';
import type { StorefrontOffer } from '../types';
import { OfferTabs, type OfferTabsProps } from './OfferTabs';
import { AFFILIATE_CREDENTIALS_PATH } from './OfferRow';

const t = storefrontStrings.offers;

const offer = (id: string, p: Partial<StorefrontOffer> = {}): StorefrontOffer => ({
  id, status: 'DRAFT', position: 0, provider: 'SHOPEE', sourceUrl: 's', affiliateUrl: `https://x.test/${id}`, attributionVerified: true,
  title: `Oferta ${id}`, priceCents: 4990, originalPriceCents: 7990, imageUrl: null, category: 'casa',
  publishedAt: null, createdAt: '', updatedAt: '', ...p,
});

const setup = (props: Partial<OfferTabsProps> = {}, mode: 'light' | 'dark' = 'light') => {
  const h = {
    onTabChange: vi.fn(), onReorder: vi.fn(), onToggleStatus: vi.fn().mockResolvedValue(undefined),
    onEdit: vi.fn(), onDelete: vi.fn().mockResolvedValue(undefined),
  };
  renderWithTheme(
    <MemoryRouter>
      <OfferTabs
        drafts={[offer('a'), offer('b'), offer('c')]}
        published={[offer('p', { status: 'PUBLISHED' })]}
        tab="drafts"
        categories={[{ key: 'casa', label: 'Casa' }]}
        {...h}
        {...props}
      />
    </MemoryRouter>,
    mode,
  );
  return h;
};

const rowOf = (title: string) => screen.getByText(title).closest('li') as HTMLElement;

describe('OfferTabs', () => {
  it('mostra as abas com contador e troca de aba', () => {
    const h = setup();
    expect(screen.getByRole('tab', { name: t.tabs.drafts(3) })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: t.tabs.published(1) }));
    expect(h.onTabChange).toHaveBeenCalledWith('published');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('oferta sem título mostra o aviso em vez de linha vazia', () => {
    setup({ drafts: [offer('a', { title: '  ' })] });
    expect(screen.getByText(t.untitled)).toBeInTheDocument();
  });

  it('aba vazia mostra o texto de estado vazio', () => {
    setup({ published: [], tab: 'published' });
    expect(screen.getByText(t.emptyPublished.title)).toBeInTheDocument();
    expect(screen.getByText(t.emptyPublished.description)).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('▲▼ desabilitam nas pontas e chamam onReorder com a aba inteira na nova ordem', () => {
    const h = setup();
    expect(within(rowOf('Oferta a')).getByRole('button', { name: t.moveUp })).toBeDisabled();
    expect(within(rowOf('Oferta c')).getByRole('button', { name: t.moveDown })).toBeDisabled();
    fireEvent.click(within(rowOf('Oferta a')).getByRole('button', { name: t.moveDown }));
    expect(h.onReorder).toHaveBeenLastCalledWith('DRAFT', ['b', 'a', 'c']);
    fireEvent.click(within(rowOf('Oferta c')).getByRole('button', { name: t.moveUp }));
    expect(h.onReorder).toHaveBeenLastCalledWith('DRAFT', ['a', 'c', 'b']);
  });

  it('na aba Publicadas reordena com status PUBLISHED e oferece Despublicar', async () => {
    const pub = [offer('p1', { status: 'PUBLISHED' }), offer('p2', { status: 'PUBLISHED' })];
    const h = setup({ published: pub, tab: 'published' });
    fireEvent.click(within(rowOf('Oferta p2')).getByRole('button', { name: t.moveUp }));
    expect(h.onReorder).toHaveBeenCalledWith('PUBLISHED', ['p2', 'p1']);
    fireEvent.click(within(rowOf('Oferta p1')).getByRole('button', { name: t.unpublish }));
    await waitFor(() => expect(h.onToggleStatus).toHaveBeenCalledWith(pub[0]));
  });

  it('apagar só chama onDelete depois de confirmar', async () => {
    const h = setup();
    fireEvent.click(within(rowOf('Oferta b')).getByRole('button', { name: t.delete }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(t.confirmDelete.message('Oferta b'))).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: t.confirmDelete.cancel }));
    expect(h.onDelete).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(rowOf('Oferta b')).getByRole('button', { name: t.delete }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: t.confirmDelete.confirm }));
    await waitFor(() => expect(h.onDelete).toHaveBeenCalledTimes(1));
    expect(h.onDelete.mock.calls[0]?.[0]).toMatchObject({ id: 'b' });
  });

  it('selo "comissão não verificada" só aparece quando não verificada e leva às credenciais', () => {
    setup({ drafts: [offer('a'), offer('b', { attributionVerified: false })] });
    expect(within(rowOf('Oferta a')).queryByText(t.unverified.badge)).toBeNull();
    const badge = within(rowOf('Oferta b')).getByRole('link', { name: new RegExp(t.unverified.badge) });
    expect(badge).toHaveAttribute('href', AFFILIATE_CREDENTIALS_PATH);
  });

  it('mostra provedor, categoria, preço "de" riscado e preço por', () => {
    setup({ drafts: [offer('a')] });
    const row = rowOf('Oferta a');
    expect(within(row).getByText('Shopee')).toBeInTheDocument();
    expect(within(row).getByText('Casa')).toBeInTheDocument();
    expect(within(row).getByText(/79,90/)).toHaveStyle({ textDecoration: 'line-through' });
    expect(within(row).getByText(/49,90/)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: t.publish }));
  });

  it('renderiza no modo escuro', () => {
    setup({}, 'dark');
    expect(screen.getByRole('tab', { name: t.tabs.drafts(3) })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: t.dragHandle })).toHaveLength(3);
  });
});
