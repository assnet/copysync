import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { OfferWatermark } from '@/features/offerWatermark/types';
import { OfferChatPreview } from './OfferChatPreview';

// Liga o ramo MEDIA só nos testes que pedem (no produto ele segue desligado).
const media = vi.hoisted(() => ({ on: false }));
vi.mock('../utils/offerConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/offerConfig')>();
  return { ...actual, effectiveImageMode: (m: Parameters<typeof actual.effectiveImageMode>[0]) => (media.on && m === 'MEDIA' ? 'MEDIA' : actual.effectiveImageMode(m)) };
});
afterEach(() => { media.on = false; });

const watermark: OfferWatermark = {
  enabled: true, kind: 'TEXT', text: 'Minha Loja', position: 'BOTTOM_RIGHT', size: 'MEDIUM', opacity: 70,
  imageUrl: null, canEdit: true, updatedAt: null,
};

/** Simula a foto carregada com o tamanho natural dado. */
function loadPhoto(width: number, height: number) {
  const img = screen.getByAltText('Foto do produto: Fone Bluetooth') as HTMLImageElement;
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true });
  fireEvent.load(img);
}

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

  it('sem marca: só a foto, nenhuma camada', () => {
    render(<OfferChatPreview {...props} imageMode="LINK_PREVIEW" />);
    loadPhoto(800, 400);
    expect(screen.queryByTestId('offer-preview-watermark')).toBeNull();
    expect(screen.queryByTestId('watermark-mark')).toBeNull();
  });

  it('prévia do link com marca: camada sobre a área real da foto (contain no 1.91:1)', () => {
    render(<OfferChatPreview {...props} imageMode="LINK_PREVIEW" watermark={watermark} />);
    expect(screen.queryByTestId('offer-preview-watermark')).toBeNull(); // antes de saber o tamanho da foto
    loadPhoto(800, 400);
    const layer = screen.getByTestId('offer-preview-watermark');
    expect(screen.getByTestId('offer-link-preview').contains(layer)).toBe(true);
    expect(parseFloat(getComputedStyle(layer).width)).toBeCloseTo(100);
    expect(parseFloat(getComputedStyle(layer).height)).toBeCloseTo(95.5);
    expect(parseFloat(getComputedStyle(layer).top)).toBeCloseTo(2.25);
    const mark = screen.getByTestId('watermark-mark');
    expect(mark).toHaveAttribute('data-position', 'BOTTOM_RIGHT');
    expect(mark).toHaveStyle({ opacity: '0.7' });
    expect(mark.textContent).toContain('Minha Loja');
  });

  it('imagem com legenda (MEDIA) com marca: foto alta centrada na caixa quadrada', () => {
    media.on = true;
    render(<OfferChatPreview {...props} imageMode="MEDIA" watermark={watermark} />);
    expect(screen.queryByTestId('offer-link-preview')).toBeNull();
    loadPhoto(300, 600);
    const layer = screen.getByTestId('offer-preview-watermark');
    expect(parseFloat(getComputedStyle(layer).width)).toBeCloseTo(50);
    expect(parseFloat(getComputedStyle(layer).left)).toBeCloseTo(25);
    expect(parseFloat(getComputedStyle(layer).height)).toBeCloseTo(100);
    expect(screen.getByTestId('watermark-mark').textContent).toContain('Minha Loja');
  });

  it('imagem com legenda (MEDIA) sem marca: só a foto', () => {
    media.on = true;
    render(<OfferChatPreview {...props} imageMode="MEDIA" />);
    loadPhoto(300, 600);
    expect(screen.queryByTestId('offer-preview-watermark')).toBeNull();
  });
});
