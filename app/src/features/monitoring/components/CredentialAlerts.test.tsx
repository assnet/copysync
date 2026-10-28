import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { CredentialAlerts } from './CredentialAlerts';

describe('CredentialAlerts', () => {
  it.each(['light', 'dark'] as const)('%s: um alerta por loja, recusada em vermelho, com atalho para credenciais', (mode) => {
    renderWithTheme(
      <MemoryRouter>
        <CredentialAlerts alerts={[
          { provider: 'MERCADO_LIVRE', kind: 'REJECTED', since: '2026-10-28T10:00:00.000Z', code: 'AFFILIATE_CREDENTIAL_REJECTED' },
          { provider: 'SHOPEE', kind: 'MISSING', since: null, code: null },
        ]} />
      </MemoryRouter>,
      mode,
    );
    expect(screen.getByText(/Mercado Livre: a loja recusou/)).toBeInTheDocument();
    expect(screen.getByText(/Shopee: ofertas capturadas estão sendo ignoradas/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Configurar credencial de/ })).toHaveLength(2);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('lista vazia ou ausente: nada renderizado', () => {
    const { container } = renderWithTheme(<MemoryRouter><CredentialAlerts alerts={[]} /></MemoryRouter>);
    expect(container.querySelector('[role="region"]')).toBeNull();
  });
});
