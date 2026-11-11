import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { storefrontStrings } from '../strings';
import { AddOfferCard, type AddOfferDraft } from './AddOfferCard';

const t = storefrontStrings.addOffer;
const categories = [{ key: 'casa', label: 'Casa' }, { key: 'moda', label: 'Moda' }, { key: 'pet', label: 'Pet' }];

function Harness({ onExtract, mode }: { onExtract: (u: string, c: string | null) => Promise<void>; mode?: 'dark' }) {
  const [value, setValue] = useState<AddOfferDraft>({ url: '', category: null });
  return <AddOfferCard value={value} onChange={setValue} categories={categories} selectedCategories={['pet', 'casa']} onExtract={onExtract} key={mode} />;
}

describe('AddOfferCard', () => {
  it('mostra o aviso do link do produto e só libera Extrair com link', () => {
    renderWithTheme(<Harness onExtract={vi.fn()} />);
    expect(screen.getByText(t.productLinkHint)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.extract })).toBeDisabled();
  });

  it('categoria só lista "Sem categoria" e as selecionadas na página', async () => {
    renderWithTheme(<Harness onExtract={vi.fn()} />);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: t.categoryLabel }));
    const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual([t.noCategory, 'Casa', 'Pet']);
  });

  it('extrai com link e categoria, mostrando carregamento', async () => {
    let resolve!: () => void;
    const onExtract = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    renderWithTheme(<Harness onExtract={onExtract} />);
    fireEvent.change(screen.getByLabelText(t.urlLabel), { target: { value: ' https://shopee.com.br/p-i.1.2 ' } });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: t.categoryLabel }));
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Pet' }));
    fireEvent.click(screen.getByRole('button', { name: t.extract }));
    expect(onExtract).toHaveBeenCalledWith('https://shopee.com.br/p-i.1.2', 'pet');
    expect(await screen.findByRole('button', { name: t.extracting })).toBeDisabled();
    resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: t.extract })).toBeEnabled());
  });

  it('renderiza no modo escuro com erro junto ao campo', () => {
    renderWithTheme(
      <AddOfferCard value={{ url: 'x', category: null }} onChange={vi.fn()} categories={categories} selectedCategories={[]} onExtract={vi.fn()} error="Link não suportado" />,
      'dark',
    );
    expect(screen.getByText('Link não suportado')).toBeInTheDocument();
    expect(screen.getByText(t.title)).toBeInTheDocument();
  });

  it.each([
    ['credentials', '/affiliates/credentials?returnTo=%2Fstorefront'],
    ['plans', '/affiliates/plans?feature=mercadoLivreTags'],
  ] as const)('erro com ação %s mostra o botão sob o campo', (action, href) => {
    renderWithTheme(
      <MemoryRouter initialEntries={['/storefront']}>
        <AddOfferCard value={{ url: 'x', category: null }} onChange={vi.fn()} categories={categories} selectedCategories={[]} onExtract={vi.fn()} error="Etiqueta" errorAction={action} />
      </MemoryRouter>,
      'dark',
    );
    expect(screen.getByRole('link', { name: t.actions[action] })).toHaveAttribute('href', href);
  });

  it.each(['light', 'dark'] as const)('credencial faltando mostra "Conectar <loja>" com volta para a vitrine (%s)', (mode) => {
    renderWithTheme(
      <MemoryRouter initialEntries={['/storefront']}>
        <AddOfferCard
          value={{ url: 'x', category: null }} onChange={vi.fn()} categories={categories} selectedCategories={[]} onExtract={vi.fn()}
          error="Conecte" errorAction="credentials" errorCode="AFFILIATE_CREDENTIAL_REQUIRED" errorMeta={{ provider: 'SHOPEE' }}
        />
      </MemoryRouter>,
      mode,
    );
    expect(screen.getByRole('link', { name: 'Conectar Shopee' })).toHaveAttribute('href', '/affiliates/credentials?returnTo=%2Fstorefront');
    expect(screen.queryByRole('link', { name: t.actions.credentials })).not.toBeInTheDocument();
  });

  it('credencial recusada vira "Revisar conexão"', () => {
    renderWithTheme(
      <MemoryRouter>
        <AddOfferCard
          value={{ url: 'x', category: null }} onChange={vi.fn()} categories={categories} selectedCategories={[]} onExtract={vi.fn()}
          error="Recusou" errorAction="credentials" errorCode="AFFILIATE_CREDENTIAL_REJECTED" errorMeta={{ provider: 'SHOPEE' }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Revisar conexão' })).toBeInTheDocument();
  });

  it.each(['light', 'dark'] as const)('item adicionado com link recriado mostra o aviso com a loja (%s)', (mode) => {
    renderWithTheme(
      <AddOfferCard value={{ url: '', category: null }} onChange={vi.fn()} categories={categories} selectedCategories={[]} onExtract={vi.fn()} rebuiltProvider="SHOPEE" />,
      mode,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Link recriado com a sua conta da Shopee');
  });

  it('sem link recriado ou com erro, não mostra o aviso', () => {
    const { rerender } = renderWithTheme(
      <AddOfferCard value={{ url: '', category: null }} onChange={vi.fn()} categories={categories} selectedCategories={[]} onExtract={vi.fn()} />,
    );
    expect(screen.queryByText(/Link recriado/)).not.toBeInTheDocument();
    rerender(<AddOfferCard value={{ url: 'x', category: null }} onChange={vi.fn()} categories={categories} selectedCategories={[]} onExtract={vi.fn()} rebuiltProvider="SHOPEE" error="Falhou" />);
    expect(screen.queryByText(/Link recriado/)).not.toBeInTheDocument();
  });

  it('sem erro não mostra botão de ação', () => {
    renderWithTheme(<MemoryRouter><AddOfferCard value={{ url: 'x', category: null }} onChange={vi.fn()} categories={categories} selectedCategories={[]} onExtract={vi.fn()} errorAction="plans" /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: t.actions.plans })).not.toBeInTheDocument();
  });
});
