import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { CredentialAlerts } from './CredentialAlerts';

describe('CredentialAlerts', () => {
  it.each(['light', 'dark'] as const)('%s: uma linha por loja na região de avisos, com atalho para credenciais', (mode) => {
    renderWithTheme(
      <MemoryRouter>
        <CredentialAlerts alerts={[
          { provider: 'MERCADO_LIVRE', kind: 'REJECTED', since: '2026-10-28T10:00:00.000Z', code: 'AFFILIATE_CREDENTIAL_REJECTED' },
          { provider: 'SHOPEE', kind: 'MISSING', since: null, code: null },
        ]} />
      </MemoryRouter>,
      mode,
    );
    const region = screen.getByRole('region', { name: 'Avisos de credenciais' });
    expect(within(region).getByText('Mercado Livre recusou a sua credencial')).toBeInTheDocument();
    expect(within(region).getByText('Shopee sem credencial de afiliado')).toBeInTheDocument();
    expect(within(region).getByText(/Desde \d{2}\/\d{2}\/\d{4}/)).toBeInTheDocument();
    expect(within(region).getAllByRole('button', { name: /Configurar credencial de/ })).toHaveLength(2);
    expect(within(region).getAllByRole('listitem')).toHaveLength(2);
  });

  it('lista vazia ou ausente: nada renderizado', () => {
    const { container } = renderWithTheme(<MemoryRouter><CredentialAlerts alerts={[]} /></MemoryRouter>);
    expect(container.querySelector('[role="region"]')).toBeNull();
  });
});
