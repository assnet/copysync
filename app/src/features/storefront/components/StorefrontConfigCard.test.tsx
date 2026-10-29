import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import { PREMIUM_SLUG_OFFER } from '@/features/plans/catalog';
import { formFromOverview } from '../storefrontForm';
import { storefrontStrings } from '../strings';
import type { StorefrontOverview } from '../types';
import { StorefrontConfigCard, type StorefrontConfigCardProps } from './StorefrontConfigCard';

const t = storefrontStrings;

const page = {
  id: 's1', title: 'Achadinhos da Ana', subtitle: null, avatarUrl: null, coverUrl: null,
  colorPrimary: '#2563EB', colorBackground: '#F5F5F5', colorCard: '#FFFFFF', categories: [],
  status: 'ACTIVE' as const, domainId: 'd1', slug: 'ana', createdAt: '', updatedAt: '',
};
const base: StorefrontOverview = {
  storefront: page,
  publicUrl: 'https://ana.ofertas.app',
  offers: { drafts: [], published: [] },
  categories: [{ key: 'casa', label: 'Casa' }, { key: 'moda', label: 'Moda' }],
  subtitleSuggestions: ['As melhores ofertas'],
  domains: [{ id: 'd1', hostname: 'ofertas.app' }],
};

const setup = (props: Partial<StorefrontConfigCardProps> = {}, mode: 'light' | 'dark' = 'light') => {
  const overview = props.overview ?? base;
  const handlers = {
    onChange: vi.fn(), onEdit: vi.fn(), onCancel: vi.fn(), onSave: vi.fn(), onImageUploaded: vi.fn(), onImageRemove: vi.fn(),
  };
  renderWithTheme(
    <PrivacyProvider>
      <StorefrontConfigCard
        overview={overview} form={formFromOverview(overview)} editing={false} saving={false}
        slug={{ status: null, checking: false, suggestions: [] }} slugChange={null}
        {...handlers} {...props}
      />
    </PrivacyProvider>,
    mode,
  );
  return handlers;
};

describe('StorefrontConfigCard', () => {
  it('resumo mostra nome, endereço e Editar', () => {
    const { onEdit } = setup();
    expect(screen.getByText(page.title)).toBeInTheDocument();
    expect(screen.getByText('https://ana.ofertas.app')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.config.edit }));
    expect(onEdit).toHaveBeenCalled();
  });

  it('sem página convida a criar (modo escuro)', () => {
    const { onEdit } = setup({ overview: { ...base, storefront: null, publicUrl: null } }, 'dark');
    fireEvent.click(screen.getByRole('button', { name: t.empty.cta }));
    expect(onEdit).toHaveBeenCalled();
  });

  it('em edição mostra o formulário, salva e cancela', () => {
    const { onSave, onCancel, onChange } = setup({ editing: true });
    fireEvent.click(screen.getByText('Moda'));
    expect(onChange).toHaveBeenCalledWith('categories', ['moda']);
    fireEvent.click(screen.getByRole('button', { name: t.config.save }));
    expect(onSave).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t.config.cancel }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('avisa a troca de endereço quando slugChange existe', () => {
    setup({ editing: true, slugChange: { from: 'https://ana.ofertas.app', to: 'https://bia.ofertas.app' } });
    expect(screen.getByText(t.fields.subdomain.changeWarning('https://ana.ofertas.app', 'https://bia.ofertas.app'))).toBeInTheDocument();
  });

  it('nome especial abre o banner de compra', () => {
    setup({ editing: true, slug: { status: 'PREMIUM', checking: false, suggestions: [] } });
    expect(screen.getByText(PREMIUM_SLUG_OFFER.title)).toBeInTheDocument();
  });

  it('criação esconde as imagens até salvar', () => {
    setup({ editing: true, overview: { ...base, storefront: null, publicUrl: null } });
    expect(screen.getByText(t.fields.images.afterSave)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.config.create })).toBeInTheDocument();
  });
});
