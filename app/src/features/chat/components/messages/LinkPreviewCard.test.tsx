import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PrivacyProvider } from '@/features/privacy';
import { LinkPreviewCard } from './LinkPreviewCard';
import type { LinkPreview } from '../../types';

const base: LinkPreview = {
  url: 'https://www.loja.com.br/produto/123?ref=abc',
  title: 'Fone sem fio com cancelamento de ruído',
  description: 'De R$ 299 por R$ 149 no Pix',
  thumbnailUrl: '/api/storage/media/s_m_lp.jpg',
};

const withPrivacy = ({ children }: { children: ReactNode }) => <PrivacyProvider>{children}</PrivacyProvider>;

function renderCard(preview: LinkPreview = base) {
  return render(<LinkPreviewCard preview={preview} isOut={false} textColor="#111" />, { wrapper: withPrivacy });
}

function loadImage(naturalWidth: number) {
  const img = screen.getByRole('img', { hidden: true }) as HTMLImageElement;
  Object.defineProperty(img, 'naturalWidth', { value: naturalWidth, configurable: true });
  act(() => {
    fireEvent.load(img);
  });
}

beforeEach(() => localStorage.clear());

describe('LinkPreviewCard', () => {
  it('abre em nova aba com rel seguro e mostra título, descrição e domínio', () => {
    renderCard();
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe(base.url);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('aria-label')).toBe('Abrir link em nova aba: www.loja.com.br');
    expect(screen.getByText(base.title!)).toBeTruthy();
    expect(screen.getByText(base.description!)).toBeTruthy();
    expect(screen.getByText('www.loja.com.br')).toBeTruthy();
  });

  it('miniatura larga (≥ 300 px) vai em cima, 16:9', () => {
    renderCard();
    loadImage(640);
    expect(screen.getByRole('img').getAttribute('data-thumb-mode')).toBe('large');
  });

  it('miniatura estreita fica quadrada à esquerda', () => {
    renderCard();
    loadImage(120);
    expect(screen.getByRole('img').getAttribute('data-thumb-mode')).toBe('small');
  });

  it('sem miniatura ou com erro de carga cai para o modo sem imagem', () => {
    const { unmount } = renderCard({ ...base, thumbnailUrl: null });
    expect(screen.queryByRole('img')).toBeNull();
    unmount();

    renderCard();
    act(() => {
      fireEvent.error(screen.getByRole('img', { hidden: true }));
    });
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('URL fora de http/https não vira link', () => {
    renderCard({ ...base, url: 'javascript:alert(1)' });
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('flags borram imagem e textos (domínio incluído) sem mudar a estrutura', () => {
    localStorage.setItem('privacy.blur', JSON.stringify(['chat.linkPreviewImages', 'chat.linkPreviewText']));
    renderCard();
    loadImage(640);
    expect(screen.getByRole('img').getAttribute('data-thumb-mode')).toBe('large');
    expect(getComputedStyle(screen.getByRole('img')).filter).toContain('blur(12px)');
    for (const text of [base.title!, base.description!, 'www.loja.com.br']) {
      expect(screen.getByText(text).closest('[data-blurred]')).not.toBeNull();
    }
  });

  it('flags desligadas não borram nada', () => {
    renderCard();
    expect(screen.getByText(base.title!).closest('[data-blurred]')).toBeNull();
    expect(screen.getByText('www.loja.com.br').closest('[data-blurred]')).toBeNull();
  });
});
