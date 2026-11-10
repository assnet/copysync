import { describe, expect, it } from 'vitest';
import { DEFAULT_OFFER_IMAGE_MODE, effectiveImageMode, MEDIA_IMAGE_MODE_ENABLED } from './OfferImageMode';

describe('effectiveImageMode', () => {
  it('MEDIA desligado: MEDIA vira LINK_PREVIEW; LINK_PREVIEW fica', () => {
    expect(MEDIA_IMAGE_MODE_ENABLED).toBe(false);
    expect(effectiveImageMode('MEDIA')).toBe('LINK_PREVIEW');
    expect(effectiveImageMode('LINK_PREVIEW')).toBe('LINK_PREVIEW');
  });
  it('padrão de oferta nova é LINK_PREVIEW', () => {
    expect(DEFAULT_OFFER_IMAGE_MODE).toBe('LINK_PREVIEW');
  });
});
