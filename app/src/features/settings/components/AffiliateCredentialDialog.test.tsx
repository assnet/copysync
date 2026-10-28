import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import type { AffiliateCredentialItem } from '@/types/api.types';
import { AFFILIATE_PROVIDERS } from '../affiliateProviders';
import { AffiliateCredentialDialog } from './AffiliateCredentialDialog';

const shopee = AFFILIATE_PROVIDERS.find((p) => p.provider === 'SHOPEE')!;
const amazon = AFFILIATE_PROVIDERS.find((p) => p.provider === 'AMAZON')!;

const savedShopee: AffiliateCredentialItem = {
  provider: 'SHOPEE',
  status: 'ACTIVE',
  publicIdentifier: '1234567',
  publicIdentifierMasked: '••••4567',
  hasSecret: true,
  hasSession: false,
  sessionSyncedAt: null,
  lastValidatedAt: null,
  rejectedAt: null,
  rejectedCode: null,
  updatedAt: '2026-10-22T10:00:00.000Z',
};

describe('AffiliateCredentialDialog', () => {
  it('não envia quando os campos obrigatórios estão vazios', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithTheme(<AffiliateCredentialDialog open spec={shopee} onSubmit={onSubmit} onClose={vi.fn()} />, 'dark');

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Informe app id.')).toBeInTheDocument();
    expect(screen.getByText('Informe secret.')).toBeInTheDocument();
  });

  it('recusa identificador fora do formato do marketplace', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithTheme(<AffiliateCredentialDialog open spec={amazon} onSubmit={onSubmit} onClose={vi.fn()} />, 'dark');

    await userEvent.type(screen.getByLabelText(/ID de rastreamento/), 'minhaloja');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('ID de rastreamento em formato inválido.')).toBeInTheDocument();
  });

  it('na edição pré-preenche o identificador e não envia secret vazio', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithTheme(
      <AffiliateCredentialDialog open spec={shopee} item={savedShopee} onSubmit={onSubmit} onClose={vi.fn()} />,
      'dark',
    );

    expect(screen.getByLabelText(/App ID/)).toHaveValue('1234567');
    expect(screen.getByPlaceholderText('Vazio mantém o atual')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ publicIdentifier: '1234567' }));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('secret');
  });

  it('mantém os valores e mostra mensagem amigável quando a API recusa', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      Object.assign(new Error('raw'), { status: 503, code: 'SECRET_CIPHER_UNAVAILABLE' }),
    );
    renderWithTheme(<AffiliateCredentialDialog open spec={shopee} onSubmit={onSubmit} onClose={vi.fn()} />, 'dark');

    await userEvent.type(screen.getByLabelText(/App ID/), ' 123456 ');
    await userEvent.type(screen.getByLabelText(/Secret/), 'abcdefghijklmnop1234');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText(/armazenamento seguro de chaves está indisponível/)).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledWith({ publicIdentifier: '123456', secret: 'abcdefghijklmnop1234' });
    expect(screen.getByLabelText(/App ID/)).toHaveValue(' 123456 ');
    expect(screen.getByLabelText(/Secret/)).toHaveValue('abcdefghijklmnop1234');
  });
});
