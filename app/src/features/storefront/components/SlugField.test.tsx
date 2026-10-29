import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import { SLUG_STATUSES, slugStatusView } from '../storefrontForm';
import { storefrontStrings } from '../strings';
import type { SlugAvailabilityStatus } from '../types';
import { SlugField, type SlugFieldProps } from './SlugField';

const t = storefrontStrings.fields.subdomain;
const domains = [{ id: 'd1', hostname: 'ofertas.app' }];

const setup = (props: Partial<SlugFieldProps> = {}, mode: 'light' | 'dark' = 'light') => {
  const onChange = vi.fn();
  const onDomainChange = vi.fn();
  renderWithTheme(
    <PrivacyProvider>
      <SlugField
        value="ana" onChange={onChange} domainId="d1" domains={domains} onDomainChange={onDomainChange}
        status={null} checking={false} suggestions={[]} {...props}
      />
    </PrivacyProvider>,
    mode,
  );
  return { onChange, onDomainChange };
};

describe('SlugField', () => {
  it.each(SLUG_STATUSES as SlugAvailabilityStatus[])('mostra o texto e o tom do estado %s', (status) => {
    setup({ status });
    const view = slugStatusView(status);
    const text = screen.getByText(view.text);
    expect(text).toHaveAttribute('data-tone', view.tone);
  });

  it('mostra "Verificando…" enquanto checa, no lugar do estado', () => {
    setup({ status: 'AVAILABLE', checking: true });
    expect(screen.getByText(t.checking)).toBeInTheDocument();
    expect(screen.queryByText(storefrontStrings.slugStatus.AVAILABLE)).not.toBeInTheDocument();
  });

  it('erro local prevalece sobre o estado da API', () => {
    setup({ status: 'AVAILABLE', error: 'erro local' });
    expect(screen.getByText('erro local')).toHaveAttribute('data-tone', 'error');
  });

  it('mostra o sufixo do domínio e normaliza o que é digitado', () => {
    const { onChange } = setup();
    expect(screen.getByText('.ofertas.app')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: new RegExp(t.label) }), { target: { value: 'Ação Já' } });
    expect(onChange).toHaveBeenCalledWith('acao-ja');
  });

  it('clicar numa sugestão troca o nome', () => {
    const { onChange } = setup({ status: 'TAKEN', suggestions: ['ana-ofertas', 'ana-2'] });
    expect(screen.getByText(t.suggestionsLabel)).toBeInTheDocument();
    fireEvent.click(screen.getByText('ana-2'));
    expect(onChange).toHaveBeenCalledWith('ana-2');
  });

  it('seletor de domínio só aparece com mais de um ativo', () => {
    setup();
    expect(screen.queryByLabelText(t.domainLabel)).not.toBeInTheDocument();
  });

  it('com dois domínios mostra o seletor (modo escuro)', () => {
    setup({ domains: [...domains, { id: 'd2', hostname: 'loja.app' }] }, 'dark');
    expect(screen.getByLabelText(t.domainLabel)).toBeInTheDocument();
  });
});
