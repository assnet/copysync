import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { StorefrontOverview } from '../types';

const svc = vi.hoisted(() => ({ getStorefront: vi.fn(), extractOffer: vi.fn() }));
vi.mock('@/services/storefront.service', () => ({ storefrontService: svc }));

import { useStorefrontPage } from './useStorefrontPage';

const overview: StorefrontOverview = {
  storefront: null, publicUrl: null, offers: { drafts: [], published: [] }, categories: [], subtitleSuggestions: [], domains: [],
};
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

async function withRebuiltNotice() {
  const hook = renderHook(() => useStorefrontPage(), { wrapper });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await act(async () => { await hook.result.current.extract('https://s.shopee.com.br/x', null); });
  expect(hook.result.current.addRebuiltProvider).toBe('SHOPEE');
  return hook;
}

describe('useStorefrontPage — aviso de link recriado', () => {
  beforeEach(() => {
    sessionStorage.clear();
    svc.getStorefront.mockResolvedValue(overview);
    svc.extractOffer.mockResolvedValue({ id: 'o1', provider: 'SHOPEE', status: 'DRAFT', linkRebuilt: true });
  });

  it('editar o link apaga o aviso junto com o rascunho', async () => {
    const { result } = await withRebuiltNotice();
    act(() => { result.current.editAddDraft({ ...result.current.addDraft, url: 'h' }); });
    expect(result.current.addRebuiltProvider).toBeNull();
    expect(result.current.addDraft.url).toBe('h');
  });

  it('mudar só a categoria mantém o aviso', async () => {
    const { result } = await withRebuiltNotice();
    act(() => { result.current.editAddDraft({ ...result.current.addDraft, category: 'pet_shop' }); });
    expect(result.current.addRebuiltProvider).toBe('SHOPEE');
  });
});
