import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => {
  const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } });
  return {
    get: vi.fn((..._a: unknown[]) => ok({ status: 'AVAILABLE' })),
    post: vi.fn((..._a: unknown[]) => ok({ html: '<p>ok</p>' })),
    patch: vi.fn((..._a: unknown[]) => ok({ id: 'o1' })),
    put: vi.fn((..._a: unknown[]) => ok({ url: '/m/x.webp' })),
    delete: vi.fn((..._a: unknown[]) => Promise.resolve({ data: undefined })),
  };
});
vi.mock('@/services/apiClient', () => ({ apiClient: http }));

import { storefrontService as svc } from '@/services/storefront.service';

const draft = {
  title: 'Loja',
  subtitle: null,
  colorPrimary: '#2563EB',
  colorBackground: '#F5F5F5',
  colorCard: '#FFFFFF',
  categories: [],
};

describe('storefrontService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lê a página e confere o nome no contrato', async () => {
    await svc.getStorefront();
    expect(http.get).toHaveBeenLastCalledWith('/storefront');
    expect(await svc.checkSlug('promo', 'd1')).toEqual({ status: 'AVAILABLE' });
    expect(http.get).toHaveBeenLastCalledWith('/storefront/slug-availability', { params: { slug: 'promo', domainId: 'd1' } });
    await svc.checkSlug('promo');
    expect(http.get).toHaveBeenLastCalledWith('/storefront/slug-availability', { params: { slug: 'promo' } });
  });

  it('salva a página, as imagens e a prévia', async () => {
    const body = { ...draft, domainId: 'd1', slug: 'promo' };
    await svc.saveStorefront(body);
    expect(http.put).toHaveBeenLastCalledWith('/storefront', body);
    expect(await svc.setImage('cover', 'u-1')).toEqual({ url: '/m/x.webp' });
    expect(http.put).toHaveBeenLastCalledWith('/storefront/images/cover', { uploadId: 'u-1' });
    await svc.removeImage('avatar');
    expect(http.delete).toHaveBeenLastCalledWith('/storefront/images/avatar');
    expect(await svc.preview(draft, 'desktop')).toBe('<p>ok</p>');
    expect(http.post).toHaveBeenLastCalledWith('/storefront/preview', { ...draft, viewport: 'desktop' });
  });

  it('extrai, edita, publica, ordena e apaga ofertas', async () => {
    await svc.extractOffer('https://x.test/p');
    expect(http.post).toHaveBeenLastCalledWith('/storefront/offers', { url: 'https://x.test/p' });
    await svc.extractOffer('https://x.test/p', 'casa');
    expect(http.post).toHaveBeenLastCalledWith('/storefront/offers', { url: 'https://x.test/p', category: 'casa' });
    await svc.updateOffer('o1', { title: 'Novo' });
    expect(http.patch).toHaveBeenLastCalledWith('/storefront/offers/o1', { title: 'Novo' });
    await svc.setOfferStatus('o1', 'PUBLISHED');
    expect(http.post).toHaveBeenLastCalledWith('/storefront/offers/o1/status', { status: 'PUBLISHED' });
    await svc.reorderOffers('DRAFT', ['b', 'a']);
    expect(http.put).toHaveBeenLastCalledWith('/storefront/offers/order', { status: 'DRAFT', ids: ['b', 'a'] });
    await svc.deleteOffer('o/1');
    expect(http.delete).toHaveBeenLastCalledWith('/storefront/offers/o%2F1');
  });
});
