import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OfferChatPreview } from './OfferChatPreview';

const props = {
  groupTitle: 'Grupo', groupCount: 1, imageUrl: 'https://cdn.example.com/p.jpg', title: 'Fone Bluetooth',
  text: 'Oferta do dia', at: new Date().toISOString(), linkUrl: 'https://www.mercadolivre.com.br/p/1',
};

describe('OfferChatPreview', () => {
  it('imagem com legenda indisponível: MEDIA mostra o cartão da prévia do link', () => {
    render(<OfferChatPreview {...props} imageMode="MEDIA" />);
    const card = screen.getByTestId('offer-link-preview');
    expect(card.textContent).toContain('Fone Bluetooth');
  });

  it('prévia do link: cartão com a foto, o título e o domínio acima do texto', () => {
    render(<OfferChatPreview {...props} imageMode="LINK_PREVIEW" />);
    const card = screen.getByTestId('offer-link-preview');
    expect(card.querySelector('img')).toBeTruthy();
    expect(card.textContent).toContain('Fone Bluetooth');
    expect(card.textContent).toContain('mercadolivre.com.br');
    expect(screen.getByText('Oferta do dia')).toBeTruthy();
  });

  it('prévia do link sem foto: só o texto', () => {
    render(<OfferChatPreview {...props} imageUrl={null} imageMode="LINK_PREVIEW" />);
    expect(screen.queryByTestId('offer-link-preview')).toBeNull();
    expect(screen.queryByText('Sem foto')).toBeNull();
  });
});
