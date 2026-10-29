import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
});
