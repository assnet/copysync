import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { OfferItem } from '@/types/api.types';
import type { OfferWatermark } from '@/features/offerWatermark/types';
import { OfferResultPanel } from './OfferResultPanel';

const previewWatermark = vi.hoisted(() => vi.fn((): OfferWatermark | null => null));
vi.mock('@/features/offerWatermark/hooks/useOfferPreviewWatermark', () => ({ useOfferPreviewWatermark: previewWatermark }));

const offer = (over: Partial<OfferItem> = {}): OfferItem => ({
  id: 'o1', provider: 'AMAZON', sourceUrl: 'https://a', productRef: null, title: 'Fone', priceCents: null,
  originalPriceCents: null, imageUrl: null, affiliateUrl: 'https://a', attributionVerified: true, coupon: null,
  audience: 'STANDARD', mentionAll: false, imageMode: 'MEDIA', simulateTyping: false, typingSeconds: 15, scheduledAt: null, origin: 'GENERATOR', expiresAt: null,
  text: 'oferta https://a', textEdited: false, status: 'DRAFT', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over,
});

const panel = (o: OfferItem, onRegenerate = vi.fn(), linkRebuilt = false) => (
  <OfferResultPanel
    offer={o} draft={{ title: o.title ?? '', priceCents: null, originalPriceCents: null, text: o.text }} onField={vi.fn()}
    dirty={false} textTooLong={false} missingLink={false} needsManualData={false} aiFallback={false} groups={[]}
    saving={false} regenerating={false} sending={false} imageProgress={null}
    onSave={vi.fn().mockResolvedValue(undefined)} onDiscard={vi.fn()} onRegenerate={onRegenerate} onReplaceImage={vi.fn()}
    onNew={vi.fn()} newLockedReason={null} linkRebuilt={linkRebuilt}
  />
);

describe('"Gerar novamente" vale uma vez por oferta', () => {
  it('disponível: botão habilitado e chama onRegenerate', () => {
    const onRegenerate = vi.fn();
    render(panel(offer({ canRegenerate: true }), onRegenerate));
    fireEvent.click(screen.getByRole('button', { name: /Gerar novamente/ }));
    expect(onRegenerate).toHaveBeenCalledWith('STANDARD');
  });

  it('já usado: botão desabilitado', () => {
    render(panel(offer({ canRegenerate: false })));
    expect(screen.getByRole('button', { name: /Gerar novamente/ })).toBeDisabled();
  });

  it('API antiga sem o campo: segue disponível', () => {
    render(panel(offer()));
    expect(screen.getByRole('button', { name: /Gerar novamente/ })).toBeEnabled();
  });
});

describe('"Gerar novamente" sem "Reescrita com IA" no plano', () => {
  it('oferta com público de IA regenera como Padrão', () => {
    const onRegenerate = vi.fn();
    const o = offer({ audience: 'PET' });
    render(
      <OfferResultPanel
        offer={o} draft={{ title: o.title ?? '', priceCents: null, originalPriceCents: null, text: o.text }} onField={vi.fn()}
        dirty={false} textTooLong={false} missingLink={false} needsManualData={false} aiFallback={false} groups={[]}
        saving={false} regenerating={false} sending={false} imageProgress={null}
        onSave={vi.fn().mockResolvedValue(undefined)} onDiscard={vi.fn()} onRegenerate={onRegenerate} onReplaceImage={vi.fn()}
        onNew={vi.fn()} newLockedReason={null} aiRewriteEnabled={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Gerar novamente/ }));
    expect(onRegenerate).toHaveBeenCalledWith('STANDARD');
  });
});

describe('aviso de link recriado e selo de legado', () => {
  it('linkRebuilt: mostra a loja, sem URL, e sem selo de não verificado', () => {
    render(panel(offer({ provider: 'SHOPEE' }), vi.fn(), true));
    expect(screen.getByRole('status')).toHaveTextContent('Link recriado com a sua conta da Shopee');
    expect(screen.queryByText(/Não deu para confirmar/)).toBeNull();
  });

  it('sem recriar: sem aviso', () => {
    render(panel(offer()));
    expect(screen.queryByText(/Link recriado/)).toBeNull();
  });

  it('oferta antiga não verificada (inclusive Shopee) mostra o selo', () => {
    render(panel(offer({ provider: 'SHOPEE', attributionVerified: false })));
    expect(screen.getByText(/Não deu para confirmar que este link é seu/)).toBeInTheDocument();
  });
});

describe('prévia com a marca d\'água do tenant', () => {
  it('marca ativa do hook chega à foto da prévia', () => {
    previewWatermark.mockReturnValue({
      enabled: true, kind: 'TEXT', text: 'Loja X', position: 'CENTER', size: 'SMALL', opacity: 50,
      imageUrl: null, canEdit: true, updatedAt: null,
    });
    render(panel(offer({ imageUrl: 'https://cdn.example.com/p.jpg', imageMode: 'LINK_PREVIEW' })));
    const img = screen.getByAltText(/Foto do produto/) as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 600, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    fireEvent.load(img);
    expect(screen.getByTestId('watermark-mark')).toHaveAttribute('data-position', 'CENTER');
    previewWatermark.mockReturnValue(null);
  });
});
