import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import { STOREFRONT_FORM_DEFAULTS } from '../storefrontForm';
import { storefrontStrings } from '../strings';
import type { StorefrontViewport } from '../types';

const preview = vi.hoisted(() => vi.fn());
vi.mock('@/services/storefront.service', () => ({ storefrontService: { preview } }));

import { PREVIEW_DEBOUNCE_MS } from '../hooks/useStorefrontPreview';
import { PREVIEW_WIDTHS, StorefrontPreview } from './StorefrontPreview';

const t = storefrontStrings.preview;
const draft = { ...STOREFRONT_FORM_DEFAULTS, title: 'Achadinhos' };

function setup(viewport: StorefrontViewport = 'mobile', mode: 'light' | 'dark' = 'light') {
  const onViewportChange = vi.fn();
  const view = renderWithTheme(
    <PrivacyProvider><StorefrontPreview draft={draft} viewport={viewport} onViewportChange={onViewportChange} /></PrivacyProvider>,
    mode,
  );
  return { ...view, onViewportChange };
}

const frame = () => screen.getByTitle(t.frameTitle) as HTMLIFrameElement;

describe('StorefrontPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    preview.mockReset().mockResolvedValue('<h1>vitrine</h1>');
    localStorage.clear();
  });

  it('iframe com sandbox vazio e o html da API em srcdoc', async () => {
    setup();
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS); });
    await act(async () => { await Promise.resolve(); });
    expect(frame()).toHaveAttribute('sandbox', '');
    expect(frame().getAttribute('srcdoc')).toBe('<h1>vitrine</h1>');
    expect(screen.getByText(t.title)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('toggle muda a largura do iframe e avisa a página', () => {
    const { onViewportChange, rerender } = setup('mobile');
    expect(frame().style.width).toBe(`${PREVIEW_WIDTHS.mobile}px`);
    fireEvent.click(screen.getByRole('button', { name: t.desktop }));
    expect(onViewportChange).toHaveBeenCalledWith('desktop');
    rerender(<PrivacyProvider><StorefrontPreview draft={draft} viewport="desktop" onViewportChange={onViewportChange} /></PrivacyProvider>);
    expect(frame().style.width).toBe(`${PREVIEW_WIDTHS.desktop}px`);
    expect(screen.getByRole('button', { name: t.desktop })).toHaveAttribute('aria-pressed', 'true');
    vi.useRealTimers();
  });

  it('qualquer flag storefront ligada borra a prévia inteira', () => {
    localStorage.setItem('privacy.blur', JSON.stringify(['storefront.offerImage']));
    const { container } = setup();
    expect(container.querySelector('[data-blurred="true"] iframe')).not.toBeNull();
    expect(screen.getByText(t.blurred)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('sem flag storefront não borra', () => {
    localStorage.setItem('privacy.blur', JSON.stringify(['offers.groupNames']));
    const { container } = setup();
    expect(container.querySelector('[data-blurred="true"]')).toBeNull();
    vi.useRealTimers();
  });

  it('renderiza no modo escuro', () => {
    setup('desktop', 'dark');
    expect(frame()).toHaveAttribute('sandbox', '');
    expect(screen.getByRole('button', { name: t.mobile })).toHaveAttribute('aria-pressed', 'false');
    vi.useRealTimers();
  });
});
