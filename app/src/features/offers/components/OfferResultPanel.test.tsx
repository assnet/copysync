import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { OfferItem } from '@/types/api.types';
import { OfferResultPanel } from './OfferResultPanel';

const offer = (over: Partial<OfferItem> = {}): OfferItem => ({
  id: 'o1', provider: 'AMAZON', sourceUrl: 'https://a', productRef: null, title: 'Fone', priceCents: null,
  originalPriceCents: null, imageUrl: null, affiliateUrl: 'https://a', attributionVerified: true, coupon: null,
  audience: 'STANDARD', mentionAll: false, imageMode: 'MEDIA', simulateTyping: false, typingSeconds: 15, scheduledAt: null, origin: 'GENERATOR', expiresAt: null,
  text: 'oferta https://a', textEdited: false, status: 'DRAFT', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over,
});

const panel = (o: OfferItem, onRegenerate = vi.fn()) => (
  <OfferResultPanel
    offer={o} draft={{ title: o.title ?? '', priceCents: null, originalPriceCents: null, text: o.text }} onField={vi.fn()}
    dirty={false} textTooLong={false} missingLink={false} needsManualData={false} aiFallback={false} groups={[]}
    saving={false} regenerating={false} sending={false} imageProgress={null}
    onSave={vi.fn().mockResolvedValue(undefined)} onDiscard={vi.fn()} onRegenerate={onRegenerate} onReplaceImage={vi.fn()}
    onNew={vi.fn()} newLockedReason={null}
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
