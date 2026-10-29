import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { STOREFRONT_FORM_DEFAULTS, type StorefrontFormState } from '../storefrontForm';
import type { StorefrontViewport } from '../types';

const preview = vi.hoisted(() => vi.fn());
vi.mock('@/services/storefront.service', () => ({ storefrontService: { preview } }));

import { PREVIEW_DEBOUNCE_MS, useStorefrontPreview } from './useStorefrontPreview';

const form = (title: string): StorefrontFormState => ({ ...STOREFRONT_FORM_DEFAULTS, title });

/** Promessa controlada por fora: resolve na ordem que o teste escolher. */
function deferred() {
  let resolve!: (v: string) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => act(async () => { await Promise.resolve(); });

describe('useStorefrontPreview', () => {
  beforeEach(() => { vi.useFakeTimers(); preview.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it('digitação rápida chama a prévia uma vez só, com o rascunho final', async () => {
    preview.mockResolvedValue('<p>ok</p>');
    const { result, rerender } = renderHook(
      ({ draft, viewport }: { draft: StorefrontFormState; viewport: StorefrontViewport }) => useStorefrontPreview(draft, viewport),
      { initialProps: { draft: form('A'), viewport: 'mobile' } },
    );
    rerender({ draft: form('Ab'), viewport: 'mobile' });
    rerender({ draft: form('Abc'), viewport: 'mobile' });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 1); });
    expect(preview).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    await flush();
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ title: 'Abc' }), 'mobile');
    expect(result.current.html).toBe('<p>ok</p>');
    expect(result.current.loading).toBe(false);
  });

  it('resposta antiga que chega depois não sobrescreve a nova', async () => {
    const old = deferred();
    const fresh = deferred();
    preview.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const { result, rerender } = renderHook(
      ({ draft }: { draft: StorefrontFormState }) => useStorefrontPreview(draft, 'mobile'),
      { initialProps: { draft: form('velho') } },
    );
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });
    rerender({ draft: form('novo') });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });
    expect(preview).toHaveBeenCalledTimes(2);
    await act(async () => { fresh.resolve('<p>novo</p>'); });
    await act(async () => { old.resolve('<p>velho</p>'); });
    expect(result.current.html).toBe('<p>novo</p>');
  });

  it('erro mantém o último html bom e sinaliza o erro', async () => {
    preview.mockResolvedValueOnce('<p>bom</p>').mockRejectedValueOnce({ code: 'RATE_LIMITED' });
    const { result, rerender } = renderHook(
      ({ draft }: { draft: StorefrontFormState }) => useStorefrontPreview(draft, 'mobile'),
      { initialProps: { draft: form('um') } },
    );
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });
    await flush();
    expect(result.current.html).toBe('<p>bom</p>');
    rerender({ draft: form('dois') });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });
    await flush();
    expect(result.current.html).toBe('<p>bom</p>');
    expect(result.current.error).toBe(true);
  });

  it('trocar o viewport pede a prévia de novo nesse tamanho', async () => {
    preview.mockResolvedValue('<p>x</p>');
    const draft = form('igual');
    const { rerender } = renderHook(
      ({ viewport }: { viewport: StorefrontViewport }) => useStorefrontPreview(draft, viewport),
      { initialProps: { viewport: 'mobile' as StorefrontViewport } },
    );
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });
    rerender({ viewport: 'desktop' });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });
    expect(preview).toHaveBeenCalledTimes(2);
    expect(preview).toHaveBeenLastCalledWith(expect.anything(), 'desktop');
  });

  it('rerender com rascunho igual (objeto novo) não dispara outra chamada', async () => {
    preview.mockResolvedValue('<p>x</p>');
    const { rerender } = renderHook(
      ({ draft }: { draft: StorefrontFormState }) => useStorefrontPreview(draft, 'mobile'),
      { initialProps: { draft: form('mesmo') } },
    );
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });
    rerender({ draft: form('mesmo') });
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS * 2); });
    expect(preview).toHaveBeenCalledTimes(1);
  });
});
