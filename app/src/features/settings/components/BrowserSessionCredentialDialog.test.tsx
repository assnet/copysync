import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AffiliateCredentialItem, SetAffiliateIdentifiersRequest } from '@/types/api.types';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
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

function mlItem(overrides: Partial<AffiliateCredentialItem> = {}): AffiliateCredentialItem {
  return {
    provider: 'MERCADO_LIVRE', status: 'ACTIVE', publicIdentifier: 'tag_a', publicIdentifierMasked: '••g_a',
    hasSecret: false, hasSession: true, sessionSyncedAt: '2026-11-10T13:00:00.000Z', lastValidatedAt: null,
    rejectedAt: null, rejectedCode: null, updatedAt: '2026-11-10T13:00:00.000Z',
    accountIdentifiers: ['tag_a', 'tag_b', 'tag_c'], linkedIdentifiers: [], identifierLimit: 2,
    ...overrides,
  };
}

function render(
  spec: typeof ml,
  opts: { item?: AffiliateCredentialItem; onSave?: (body: SetAffiliateIdentifiersRequest) => Promise<void>; mode?: 'light' | 'dark' } = {},
) {
  return renderWithTheme(
    <MemoryRouter>
      <BrowserSessionCredentialDialog
        open
        spec={spec}
        item={opts.item}
        onSaveIdentifiers={opts.onSave ?? vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />
    </MemoryRouter>,
    opts.mode ?? 'light',
  );
}

describe('BrowserSessionCredentialDialog', () => {
  beforeEach(() => {
    ext.current = {};
    sessionStorage.clear();
  });

  it('Mercado Livre conectado: etiqueta da extensão não aparece (fonte única = API)', () => {
    connected('ml');
    render(ml);
    expect(screen.queryByTestId('wizard')).not.toBeInTheDocument();
    expect(screen.queryByText('4320454940')).not.toBeInTheDocument();
  });

  it.each(['light', 'dark'] as const)('lista as etiquetas da API com contador e item fora do limite (%s)', (mode) => {
    connected('ml');
    render(ml, { item: mlItem({ linkedIdentifiers: ['tag_b'] }), mode });
    expect(screen.getByLabelText('2 de 2 etiquetas vinculadas')).toBeInTheDocument();
    // tag_c não cabe: oculta por padrão, com contador
    expect(screen.queryByText('tag_c')).not.toBeInTheDocument();
    expect(screen.getByText('1 oculta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver planos com mais etiquetas' })).toBeInTheDocument();
  });

  it('desligar o filtro mostra o item indisponível com motivo e caixa travada', async () => {
    connected('ml');
    render(ml, { item: mlItem({ linkedIdentifiers: ['tag_b'] }) });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ocultar etiquetas fora do limite' }));
    expect(screen.getByText('tag_c')).toBeInTheDocument();
    expect(screen.getByText('Seu plano vincula até 2 etiquetas')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Vincular tag_c' })).toBeDisabled();
  });

  it('principal vazia com etiquetas na conta: pede a escolha; salvar envia principal + vinculadas', async () => {
    connected('ml');
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(ml, { item: mlItem({ publicIdentifier: null }), onSave });
    expect(screen.getByText(/Escolha a etiqueta principal/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Salvar etiquetas' });
    expect(save).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: 'Usar tag_b como principal' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Vincular tag_a' }));
    await userEvent.click(save);

    expect(onSave).toHaveBeenCalledWith({ primary: 'tag_b', linked: ['tag_a'] });
    expect(await screen.findByText('Etiquetas salvas.')).toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem('ui.affiliateCredentials.identifiers.MERCADO_LIVRE')).toBeNull());
  });

  it('rascunho sobrevive a remontar (reload) até salvar', async () => {
    connected('ml');
    const first = render(ml, { item: mlItem() });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Vincular tag_b' }));
    first.unmount();
    render(ml, { item: mlItem() });
    expect(screen.getByRole('checkbox', { name: 'Vincular tag_b' })).toBeChecked();
  });

  it('limite do plano recusado pela API: texto próprio e caminho para os planos', async () => {
    connected('ml');
    const onSave = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'PLAN_LIMIT_REACHED', meta: { key: 'mercado_livre_affiliate_tags', limit: 2 } }));
    render(ml, { item: mlItem(), onSave });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Vincular tag_b' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar etiquetas' }));
    expect(await screen.findByText(/Seu plano vincula até 2 etiquetas\. Desmarque/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver planos com mais etiquetas' })).toBeInTheDocument();
  });

  it('etiqueta fora da conta recusada (422): pede para sincronizar', async () => {
    connected('ml');
    const onSave = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'AFFILIATE_CREDENTIAL_INVALID', meta: { field: 'linked' } }));
    render(ml, { item: mlItem(), onSave });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Vincular tag_b' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar etiquetas' }));
    expect(await screen.findByText(/não está mais na sua conta/)).toBeInTheDocument();
  });

  it('conta sem etiquetas: pede para sincronizar', () => {
    connected('ml');
    render(ml, { item: mlItem({ accountIdentifiers: [], publicIdentifier: null }) });
    expect(screen.getByText(/Nenhuma etiqueta encontrada/)).toBeInTheDocument();
  });

  it('flag de privacidade ligada borra as etiquetas', () => {
    localStorage.setItem('privacy.blur', JSON.stringify(['affiliateCredentials.accountIdentifiers']));
    connected('ml');
    renderWithTheme(
      <PrivacyProvider>
        <MemoryRouter>
          <BrowserSessionCredentialDialog open spec={ml} item={mlItem()} onSaveIdentifiers={vi.fn()} onClose={vi.fn()} />
        </MemoryRouter>
      </PrivacyProvider>,
    );
    expect(screen.getByText('tag_a').closest('[data-blurred="true"]')).not.toBeNull();
    localStorage.removeItem('privacy.blur');
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
