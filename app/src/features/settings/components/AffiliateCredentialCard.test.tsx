import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '@/test/renderWithTheme';
import type { AffiliateCredentialItem } from '@/types/api.types';
import { AFFILIATE_PROVIDERS } from '../affiliateProviders';
import { AffiliateCredentialCard } from './AffiliateCredentialCard';

const spec = (provider: string) => AFFILIATE_PROVIDERS.find((p) => p.provider === provider)!;

function item(overrides: Partial<AffiliateCredentialItem>): AffiliateCredentialItem {
  return {
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
    ...overrides,
  };
}

const handlers = () => ({ onConfigure: vi.fn(), onRemove: vi.fn(), onStatusChange: vi.fn() });

describe('AffiliateCredentialCard', () => {
  it('sem credencial, os três marketplaces aparecem como "Não configurado"', () => {
    renderWithTheme(
      <>
        {AFFILIATE_PROVIDERS.map((s) => <AffiliateCredentialCard key={s.provider} spec={s} {...handlers()} />)}
      </>,
      'dark',
    );

    expect(screen.getAllByText('Não configurado')).toHaveLength(3);
    for (const s of AFFILIATE_PROVIDERS) {
      expect(screen.getByRole('button', { name: `Conectar ${s.name}` })).toBeInTheDocument();
    }
  });

  it('credencial salva mostra a máscara e nunca o valor em claro', () => {
    renderWithTheme(<AffiliateCredentialCard spec={spec('SHOPEE')} item={item({})} {...handlers()} />, 'dark');

    expect(screen.getByText('Configurado')).toBeInTheDocument();
    expect(screen.getByText('••••4567')).toBeInTheDocument();
    expect(screen.queryByText('1234567')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
  });

  it('credencial inativa mostra o chip "Inativo" e o switch desligado', () => {
    renderWithTheme(
      <AffiliateCredentialCard spec={spec('AMAZON')} item={item({ provider: 'AMAZON', status: 'INACTIVE', hasSecret: false })} {...handlers()} />,
      'dark',
    );

    expect(screen.getByText('Inativo')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Ativa' })).not.toBeChecked();
  });

  it('Mercado Livre com sessão mostra a data da sincronização', () => {
    renderWithTheme(
      <AffiliateCredentialCard
        spec={spec('MERCADO_LIVRE')}
        item={item({ provider: 'MERCADO_LIVRE', hasSecret: false, hasSession: true, sessionSyncedAt: '2026-10-22T10:00:00.000Z' })}
        {...handlers()}
      />,
      'dark',
    );

    expect(screen.getByText(/^Sessão sincronizada em \d{2}\/\d{2}\/\d{4}/)).toBeInTheDocument();
  });

  it('Mercado Livre criado pela extensão sem etiqueta mostra "ID pendente"', () => {
    renderWithTheme(
      <AffiliateCredentialCard
        spec={spec('MERCADO_LIVRE')}
        item={item({
          provider: 'MERCADO_LIVRE', publicIdentifier: null, publicIdentifierMasked: null,
          hasSecret: false, hasSession: true, sessionSyncedAt: '2026-10-22T10:00:00.000Z',
        })}
        {...handlers()}
      />,
      'dark',
    );

    expect(screen.getByText('ID pendente')).toBeInTheDocument();
  });

  it('Mercado Livre sem sessão orienta a usar a extensão do navegador', () => {
    renderWithTheme(<AffiliateCredentialCard spec={spec('MERCADO_LIVRE')} {...handlers()} />, 'dark');

    expect(screen.getByText(/Instale ou abra a extensão do navegador/)).toBeInTheDocument();
  });

  it('remover pede confirmação e, no Mercado Livre, avisa para desconectar a extensão', async () => {
    const h = handlers();
    renderWithTheme(
      <AffiliateCredentialCard spec={spec('MERCADO_LIVRE')} item={item({ provider: 'MERCADO_LIVRE', hasSecret: false })} {...h} />,
      'dark',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remover' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Desconecte a extensão do navegador antes de remover/)).toBeInTheDocument();
    expect(h.onRemove).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
    expect(h.onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('AffiliateCredentialCard — recusada', () => {
  it('rejectedAt mostra o chip "Recusada" e a dica da loja; sem rejectedAt volta a "Configurado"', () => {
    const h = handlers();
    const { unmount } = renderWithTheme(
      <AffiliateCredentialCard spec={spec('SHOPEE')} item={item({ rejectedAt: '2026-10-28T10:00:00.000Z', rejectedCode: 'AFFILIATE_CREDENTIAL_REJECTED' })} {...h} />,
    );
    expect(screen.getByText('Recusada')).toBeInTheDocument();
    expect(screen.getByText(/A loja recusou esta credencial/)).toBeInTheDocument();
    unmount();
    renderWithTheme(<AffiliateCredentialCard spec={spec('SHOPEE')} item={item({})} {...h} />);
    expect(screen.getByText('Configurado')).toBeInTheDocument();
    expect(screen.queryByText('Recusada')).not.toBeInTheDocument();
  });
});
