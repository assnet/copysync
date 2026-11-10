import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { AFFILIATE_PROVIDERS } from '../affiliateProviders';

const ext = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('@/features/extension/hooks/useExtension', () => ({
  useExtension: () => ext.current,
  syncErrorMessage: () => 'erro',
}));
vi.mock('@/features/extension/components/ExtensionSetupWizard', () => ({
  ExtensionSetupWizard: () => <div data-testid="wizard" />,
}));

import { BrowserSessionCredentialDialog } from './BrowserSessionCredentialDialog';

const ml = AFFILIATE_PROVIDERS.find((p) => p.provider === 'MERCADO_LIVRE')!;
const shein = AFFILIATE_PROVIDERS.find((p) => p.provider === 'SHEIN')!;

const credential = { publicIdentifier: '4320454940', lastSyncAt: '2026-11-10T13:00:00.000Z' };

function connected(marketplace: 'ml' | 'shein') {
  ext.current = {
    status: 'connected',
    handshake: { extVersion: '3.4.0' },
    mlStatus: { loggedIn: true },
    credentials: { [marketplace]: credential },
    sync: vi.fn(),
  };
}

function render(spec: typeof ml) {
  return renderWithTheme(
    <MemoryRouter>
      <BrowserSessionCredentialDialog open spec={spec} onClose={vi.fn()} />
    </MemoryRouter>,
    'light',
  );
}

describe('BrowserSessionCredentialDialog', () => {
  beforeEach(() => {
    ext.current = {};
  });

  it('Mercado Livre conectado: mostra o corpo com a etiqueta (comportamento de antes)', () => {
    connected('ml');
    render(ml);
    expect(screen.queryByTestId('wizard')).not.toBeInTheDocument();
    expect(screen.getByText('4320454940')).toBeInTheDocument();
  });

  it('Mercado Livre sem extensão: mostra o assistente', () => {
    ext.current = { status: 'not_detected', credentials: {}, sync: vi.fn() };
    render(ml);
    expect(screen.getByTestId('wizard')).toBeInTheDocument();
  });

  it('Shein conectada: só o assistente, nunca o ID cru', () => {
    connected('shein');
    render(shein);
    expect(screen.getByTestId('wizard')).toBeInTheDocument();
    expect(screen.queryByText('4320454940')).not.toBeInTheDocument();
  });
});
