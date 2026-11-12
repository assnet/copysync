import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrivacyProvider } from '@/features/privacy';
import { huntFind } from '../../test/fixtures';
import { HuntFindsTab, type HuntFindsTabProps } from './HuntFindsTab';

const props = (items: HuntFindsTabProps['items']): HuntFindsTabProps => ({
  items, loading: false, loadingMore: false, hasMore: false, errorCode: null, busyFindId: null, openFindId: null,
  onToggleOpen: vi.fn(), onLoadMore: vi.fn(), onReload: vi.fn(), onApprove: vi.fn(), onDismiss: vi.fn(),
});

describe('HuntFindsTab', () => {
  it('mostra a foto do achado; sem foto cai no ícone', () => {
    const { container } = render(<HuntFindsTab {...props([huntFind('1', { imageUrl: 'https://img.ltwebstatic.com/a.jpg' }), huntFind('2')])} />);
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute('src', 'https://img.ltwebstatic.com/a.jpg');
    expect(screen.getAllByTestId('hunt-find')).toHaveLength(2);
  });

  it('foto borra com offerHunter.productImages', () => {
    localStorage.setItem('privacy.blur', JSON.stringify(['offerHunter.productImages']));
    const { container } = render(<PrivacyProvider><HuntFindsTab {...props([huntFind('1', { imageUrl: 'https://img.ltwebstatic.com/a.jpg' })])} /></PrivacyProvider>);
    expect(container.querySelector('img')!.closest('[data-blurred="true"]')).not.toBeNull();
    localStorage.clear();
  });

  it('aviso de pendentes deixa claro que conta só a lista carregada', () => {
    render(<HuntFindsTab {...props([huntFind('1'), huntFind('2'), huntFind('3', { status: 'SENT' })])} hasMore />);
    expect(screen.getByText('2 achados nesta lista esperam a sua revisão')).toBeInTheDocument();
  });
});
