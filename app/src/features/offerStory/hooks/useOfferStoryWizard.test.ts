import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { writePersisted, readPersisted } from '@/hooks/usePersistedState';
import type { OfferStoryResult } from '../types';

const render = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
vi.mock('@/services/offerStory.service', () => ({ offerStoryService: { render } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

import { WIZARD_KEY, WIZARD_VERSION, restoreDraft, useOfferStoryWizard, type OfferStoryDraft } from './useOfferStoryWizard';

const URL_OK = 'https://shopee.com.br/produto-i.1.2';
const RESULT: OfferStoryResult = {
  image: 'data:image/jpeg;base64,AAAA', width: 1080, height: 1920, templateId: 'flash-night', headline: 'Fone',
  provider: 'SHOPEE', affiliateUrl: 'https://s.shopee.com.br/x', attributionVerified: true,
  price: { fromCents: null, toCents: 1000 }, coupon: null, warnings: [],
};
const saved = (patch: Partial<OfferStoryDraft>) =>
  writePersisted(WIZARD_KEY, { step: 0, templateId: '', url: '', couponEnabled: false, code: '', discount: '', ...patch }, { version: WIZARD_VERSION });

describe('useOfferStoryWizard', () => {
  beforeEach(() => { sessionStorage.clear(); render.mockReset(); navigate.mockReset(); });

  it('reload no passo 3 (sem arte) volta ao passo 2 com os campos', () => {
    saved({ step: 2, templateId: 'flash-night', url: URL_OK, couponEnabled: true, code: 'OFF10' });
    const { result } = renderHook(() => useOfferStoryWizard());
    expect(result.current.step).toBe(1);
    expect(result.current.templateId).toBe('flash-night');
    expect(result.current.form).toMatchObject({ url: URL_OK, couponEnabled: true, code: 'OFF10' });
    expect(result.current.result).toBeNull();
  });

  it('passo 2 sem template volta ao passo 1', () => {
    expect(restoreDraft({ step: 1, templateId: '' }).step).toBe(0);
    expect(restoreDraft(null).step).toBe(0);
  });

  it('gera, vai ao passo 3 e não persiste a arte', async () => {
    saved({ step: 1, templateId: 'flash-night', url: URL_OK });
    render.mockResolvedValue(RESULT);
    const { result } = renderHook(() => useOfferStoryWizard());
    await act(() => result.current.generate());
    expect(render).toHaveBeenCalledWith({ templateId: 'flash-night', url: URL_OK });
    expect(result.current.step).toBe(2);
    expect(result.current.result).toBe(RESULT);
    expect(JSON.stringify(readPersisted(WIZARD_KEY, { version: WIZARD_VERSION }))).not.toContain('base64');
  });

  it('erro de link fica no campo e no passo 2; sem plano redireciona', async () => {
    saved({ step: 1, templateId: 'flash-night', url: URL_OK });
    render.mockRejectedValueOnce({ status: 422, code: 'OFFER_LINK_NOT_OWNED' });
    const { result } = renderHook(() => useOfferStoryWizard());
    await act(() => result.current.generate());
    expect(result.current.step).toBe(1);
    expect(result.current.errors.url).toBeTruthy();

    render.mockRejectedValueOnce({ status: 403, code: 'PLAN_FEATURE_UNAVAILABLE' });
    await act(() => result.current.generate());
    expect(navigate).toHaveBeenCalledWith('/plans?feature=offerStory', { replace: true });
  });

  it('validação local não chama a API', async () => {
    saved({ step: 1, templateId: 'flash-night', url: '' });
    const { result } = renderHook(() => useOfferStoryWizard());
    await act(() => result.current.generate());
    expect(render).not.toHaveBeenCalled();
    expect(result.current.errors.url).toBeTruthy();
  });

  it('"Editar" volta ao passo 2 com campos; "Nova arte" limpa tudo', async () => {
    saved({ step: 1, templateId: 'flash-night', url: URL_OK });
    render.mockResolvedValue(RESULT);
    const { result } = renderHook(() => useOfferStoryWizard());
    await act(() => result.current.generate());
    act(() => result.current.edit());
    expect(result.current.step).toBe(1);
    expect(result.current.form.url).toBe(URL_OK);
    await act(() => result.current.generate());
    act(() => result.current.reset());
    expect(result.current.step).toBe(0);
    expect(result.current.templateId).toBe('');
    expect(result.current.form.url).toBe('');
    expect(result.current.result).toBeNull();
  });
});
