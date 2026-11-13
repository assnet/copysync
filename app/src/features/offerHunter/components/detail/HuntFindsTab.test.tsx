import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PrivacyProvider } from '@/features/privacy';
import { huntFind } from '../../test/fixtures';
import { HuntFindsTab, type HuntFindsTabProps } from './HuntFindsTab';

const props = (items: HuntFindsTabProps['items']): HuntFindsTabProps => ({
  items, loading: false, loadingMore: false, hasMore: false, errorCode: null, busyFindId: null, openFindId: null,
  onToggleOpen: vi.fn(), onLoadMore: vi.fn(), onReload: vi.fn(), onApprove: vi.fn(), onDismiss: vi.fn(),
  onRedeliver: vi.fn(async () => undefined), destinationGroupName: 'Ofertas VIP',
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

  it('envio real: "Na fila de envio" no lugar de "Enviado"; grupo e sessão no detalhe, borrados pelas flags', () => {
    localStorage.setItem('privacy.blur', JSON.stringify(['offerHunter.groupNames']));
    const item = huntFind('1', {
      status: 'SENT', offerId: 'o1', dispatchStatus: 'QUEUED', destination: { groupName: 'Ofertas VIP', sessionName: 'Loja' },
    });
    render(<PrivacyProvider><HuntFindsTab {...props([item])} openFindId="1" /></PrivacyProvider>);
    expect(screen.getByText('Na fila de envio')).toBeInTheDocument();
    expect(screen.queryByText('Enviado')).not.toBeInTheDocument();
    const group = screen.getAllByText('Ofertas VIP');
    expect(group.length).toBeGreaterThan(0);
    for (const g of group) expect(g.closest('[data-blurred="true"]')).not.toBeNull();
    expect(screen.getByText('Loja').closest('[data-blurred="true"]')).toBeNull();
    localStorage.clear();
  });

  it('reenviar: travado com envio na fila; liberado cita o grupo atual e chama onRedeliver', async () => {
    const queued = huntFind('1', { status: 'SENT', offerId: 'o1', dispatchStatus: 'SENDING' });
    const sent = huntFind('2', { status: 'SENT', offerId: 'o2', dispatchStatus: 'SENT', sentAt: '2026-11-12T15:00:00.000Z' });
    const p = props([queued, sent]);
    render(<HuntFindsTab {...p} />);
    const [b1, b2] = screen.getAllByRole('button', { name: 'Reenviar' });
    expect(b1).toBeDisabled();
    expect(screen.getByText('Enviado')).toBeInTheDocument();
    fireEvent.click(b2!);
    expect(screen.getByText(/grupo de destino atual "Ofertas VIP"/)).toBeInTheDocument();
    const confirmBtns = screen.getAllByRole('button', { name: 'Reenviar' });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]!);
    await waitFor(() => expect(p.onRedeliver).toHaveBeenCalledWith('2'));
    expect(await screen.findByText('Oferta reenviada: está na fila de envio.')).toBeInTheDocument();
  });

  it('achado sem oferta não mostra Reenviar', () => {
    render(<HuntFindsTab {...props([huntFind('1'), huntFind('2', { status: 'DISMISSED' })])} />);
    expect(screen.queryByRole('button', { name: 'Reenviar' })).not.toBeInTheDocument();
  });
});
