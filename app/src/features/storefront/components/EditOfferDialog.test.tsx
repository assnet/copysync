import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { storefrontStrings } from '../strings';
import type { StorefrontOffer } from '../types';
import { EditOfferDialog } from './EditOfferDialog';

const t = storefrontStrings.editOffer;
const offer: StorefrontOffer = {
  id: 'o1', status: 'DRAFT', position: 0, provider: 'AMAZON', sourceUrl: 's', affiliateUrl: 'a', attributionVerified: true,
  title: 'Cafeteira', priceCents: 19990, originalPriceCents: null, imageUrl: null, category: null,
  publishedAt: null, createdAt: '', updatedAt: '',
};

const setup = (mode: 'light' | 'dark' = 'light') => {
  const h = { onClose: vi.fn(), onSave: vi.fn().mockResolvedValue(undefined) };
  renderWithTheme(<EditOfferDialog offer={offer} categories={[{ key: 'casa', label: 'Casa' }]} selectedCategories={['casa']} {...h} />, mode);
  return h;
};

describe('EditOfferDialog', () => {
  it('preenche com a oferta e converte reais em centavos ao salvar', async () => {
    const h = setup();
    expect(screen.getByLabelText(t.priceLabel)).toHaveValue('199,90');
    fireEvent.change(screen.getByLabelText(t.priceLabel), { target: { value: '1.234,56' } });
    fireEvent.change(screen.getByLabelText(t.originalPriceLabel), { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    await waitFor(() => expect(h.onSave).toHaveBeenCalledWith('o1', { priceCents: 123456, originalPriceCents: 150000 }));
  });

  it('título vazio ou preço inválido não salva e mostra o erro', () => {
    const h = setup();
    fireEvent.change(screen.getByLabelText(t.titleLabel), { target: { value: '  ' } });
    fireEvent.change(screen.getByLabelText(t.priceLabel), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    expect(screen.getByText(t.titleInvalid)).toBeInTheDocument();
    expect(screen.getByText(t.priceInvalid)).toBeInTheDocument();
    expect(h.onSave).not.toHaveBeenCalled();
  });

  it('sem mudança, salvar só fecha', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    expect(h.onSave).not.toHaveBeenCalled();
    expect(h.onClose).toHaveBeenCalled();
  });

  it('renderiza no modo escuro', () => {
    setup('dark');
    expect(screen.getByRole('dialog', { name: t.title })).toBeInTheDocument();
  });
});
