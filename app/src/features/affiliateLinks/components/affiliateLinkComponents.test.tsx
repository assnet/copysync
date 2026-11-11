import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { ConnectStoreAction, credentialsPathFor } from './ConnectStoreAction';
import { LinkRebuiltNotice } from './LinkRebuiltNotice';

const MODES = ['light', 'dark'] as const;

describe('credentialsPathFor', () => {
  it('codifica a rota atual com a query', () => {
    expect(credentialsPathFor('/offers', '?id=1&x=2')).toBe('/affiliates/credentials?returnTo=%2Foffers%3Fid%3D1%26x%3D2');
    expect(credentialsPathFor('/storefront')).toBe('/affiliates/credentials?returnTo=%2Fstorefront');
  });
});

describe.each(MODES)('ConnectStoreAction (%s)', (mode) => {
  it('aponta para as credenciais com returnTo da tela atual', () => {
    renderWithTheme(
      <MemoryRouter initialEntries={['/offer-story?step=product']}>
        <ConnectStoreAction code="AFFILIATE_CREDENTIAL_REQUIRED" meta={{ provider: 'MERCADO_LIVRE' }} />
      </MemoryRouter>,
      mode,
    );
    const link = screen.getByRole('link', { name: 'Conectar Mercado Livre' });
    const href = new URL(link.getAttribute('href')!, 'http://x');
    expect(href.pathname).toBe('/affiliates/credentials');
    expect(href.searchParams.get('returnTo')).toBe('/offer-story?step=product');
  });

  it('credencial recusada vira "Revisar conexão"', () => {
    renderWithTheme(
      <MemoryRouter initialEntries={['/offers']}>
        <ConnectStoreAction code="AFFILIATE_CREDENTIAL_REJECTED" meta={{ provider: 'SHOPEE' }} />
      </MemoryRouter>,
      mode,
    );
    expect(screen.getByRole('link', { name: 'Revisar conexão' })).toBeInTheDocument();
  });
});

describe.each(MODES)('LinkRebuiltNotice (%s)', (mode) => {
  it('mostra a loja, sem URL, e explica a comissão no tooltip', async () => {
    const { container } = renderWithTheme(<LinkRebuiltNotice provider="SHOPEE" />, mode);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('Link recriado com a sua conta da Shopee');
    expect(container.textContent).not.toMatch(/https?:|\.com/);
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();

    // Alcançável por teclado (o tooltip abre no foco visível do navegador)
    await userEvent.tab();
    expect(notice).toHaveFocus();
    await userEvent.hover(notice);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('A comissão das vendas vai para você.');
    expect(notice).toHaveAccessibleDescription(/comissão das vendas vai para você/);
  });

  it('artigo masculino e loja desconhecida', () => {
    const { rerender } = renderWithTheme(<LinkRebuiltNotice provider="MERCADO_LIVRE" />, mode);
    expect(screen.getByRole('status')).toHaveTextContent('Link recriado com a sua conta do Mercado Livre');
    rerender(<LinkRebuiltNotice provider="OUTRA" />);
    expect(screen.getByRole('status')).toHaveTextContent('Link recriado com a sua conta da loja');
  });
});
