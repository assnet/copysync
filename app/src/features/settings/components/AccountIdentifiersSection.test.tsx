import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AffiliateCredentialItem, SetAffiliateIdentifiersRequest } from '@/types/api.types';
import { renderWithTheme } from '@/test/renderWithTheme';
import { AFFILIATE_PLANS_PATH } from '@/features/navigation/model';
import { AccountIdentifiersSection } from './AccountIdentifiersSection';

const DRAFT_KEY = 'ui.affiliateCredentials.identifiers.MERCADO_LIVRE';

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
  opts: { item?: AffiliateCredentialItem; onSave?: (body: SetAffiliateIdentifiersRequest) => Promise<void>; mode?: 'light' | 'dark' } = {},
) {
  return renderWithTheme(
    <MemoryRouter>
      <Routes>
        <Route
          path="*"
          element={<AccountIdentifiersSection item={opts.item ?? mlItem()} onSave={opts.onSave ?? vi.fn().mockResolvedValue(undefined)} />}
        />
        <Route path={AFFILIATE_PLANS_PATH} element={<div data-testid="plans" />} />
      </Routes>
    </MemoryRouter>,
    opts.mode ?? 'light',
  );
}

describe('AccountIdentifiersSection', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it.each(['light', 'dark'] as const)('limite cheio: item indisponível com motivo e botão de planos (%s)', async (mode) => {
    render({ item: mlItem({ linkedIdentifiers: ['tag_b'] }), mode });
    expect(screen.getByLabelText('2 de 2 etiquetas vinculadas')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ocultar etiquetas fora do limite' }));
    expect(screen.getByText('Seu plano vincula até 2 etiquetas')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Vincular tag_c' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Ver planos com mais etiquetas' }));
    expect(await screen.findByTestId('plans')).toBeInTheDocument();
  });

  it('rascunho volta após remontar e some ao ficar igual ao servidor', async () => {
    const first = render();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Vincular tag_b' }));
    expect(sessionStorage.getItem(DRAFT_KEY)).not.toBeNull();
    first.unmount();

    render();
    const box = screen.getByRole('checkbox', { name: 'Vincular tag_b' });
    expect(box).toBeChecked();
    expect(screen.getByRole('button', { name: 'Salvar etiquetas' })).toBeEnabled();

    await userEvent.click(box);
    expect(box).not.toBeChecked();
    await waitFor(() => expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull());
    expect(screen.getByRole('button', { name: 'Salvar etiquetas' })).toBeDisabled();
  });

  it('salvar envia principal + vinculadas e limpa o rascunho', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render({ item: mlItem({ identifierLimit: 3 }), onSave });
    await userEvent.click(screen.getByRole('radio', { name: 'Usar tag_c como principal' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Vincular tag_b' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar etiquetas' }));

    // a antiga principal (tag_a) vira vinculada porque coube
    expect(onSave).toHaveBeenCalledWith({ primary: 'tag_c', linked: ['tag_a', 'tag_b'] });
    expect(await screen.findByText('Etiquetas salvas.')).toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull());
  });

  it('PLAN_LIMIT_REACHED na API: texto de limite e caminho para os planos', async () => {
    const onSave = vi.fn().mockRejectedValue(
      Object.assign(new Error('x'), { code: 'PLAN_LIMIT_REACHED', meta: { key: 'mercado_livre_affiliate_tags', limit: 2 } }),
    );
    render({ onSave });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Vincular tag_b' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar etiquetas' }));
    expect(await screen.findByText(/Seu plano vincula até 2 etiquetas\. Desmarque/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver planos com mais etiquetas' })).toBeInTheDocument();
  });
});
