import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import type { AffiliateCredentialItem } from '@/types/api.types';
import { AFFILIATE_PROVIDERS } from '../affiliateProviders';
import { AffiliateConnectionSummary } from './AffiliateConnectionSummary';

const item = (provider: AffiliateCredentialItem['provider'], status: AffiliateCredentialItem['status']) =>
  ({ provider, status } as AffiliateCredentialItem);

describe('AffiliateConnectionSummary', () => {
  it('sem credenciais convida a conectar o primeiro marketplace', () => {
    renderWithTheme(<AffiliateConnectionSummary entries={AFFILIATE_PROVIDERS.map((spec) => ({ spec }))} />, 'dark');

    expect(screen.getByText('Nenhum marketplace conectado ainda')).toBeInTheDocument();
    expect(screen.getByText('Como funciona')).toBeInTheDocument();
    expect(screen.getByLabelText('Shopee não conectado')).toBeInTheDocument();
  });

  it('conta só credenciais ativas como conectadas', () => {
    const entries = AFFILIATE_PROVIDERS.map((spec) => ({
      spec,
      item: spec.provider === 'SHOPEE' ? item('SHOPEE', 'ACTIVE')
        : spec.provider === 'AMAZON' ? item('AMAZON', 'INACTIVE') : undefined,
    }));
    renderWithTheme(<AffiliateConnectionSummary entries={entries} />);

    expect(screen.getByText('1 de 3 marketplaces conectados')).toBeInTheDocument();
    expect(screen.getByLabelText('Shopee conectado')).toBeInTheDocument();
    expect(screen.getByLabelText('Amazon não conectado')).toBeInTheDocument();
  });
});
