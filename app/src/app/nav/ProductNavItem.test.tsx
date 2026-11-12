import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { buildNavigation } from '@/features/navigation';
import { ProductNavItem } from './ProductNavItem';

const model = buildNavigation({ isSuperAdmin: false, offerHunterVisible: false });
const affiliates = model.products[0];
const soonProduct = model.products.find((p) => p.status === 'soon')!;

describe('ProductNavItem', () => {
  it('produto disponível expande/recolhe sem navegar', () => {
    const onToggle = vi.fn();
    const onNavigate = vi.fn();
    render(<ProductNavItem product={affiliates} expanded={false} idPrefix="desktop" onToggle={onToggle} onNavigate={onNavigate} />);
    const row = screen.getByRole('button', { name: 'Afiliados' });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(row);
    expect(onToggle).toHaveBeenCalledWith('affiliates');
    expect(onNavigate).not.toHaveBeenCalled();
    expect(row).not.toHaveAttribute('aria-controls');
  });

  it('expandido mostra os filhos e marca o ativo com aria-current', () => {
    const onNavigate = vi.fn();
    render(
      <ProductNavItem product={affiliates} expanded activeChildKey="monitoring" idPrefix="mobile" onToggle={() => undefined} onNavigate={onNavigate} />,
    );
    const row = screen.getByRole('button', { name: 'Afiliados' });
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(row).toHaveAttribute('aria-controls', 'nav-mobile-product-affiliates');
    const active = screen.getByText('Monitoramento').closest('[role="button"]');
    expect(active).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByText('Gerador de ofertas'));
    expect(onNavigate).toHaveBeenCalledWith('/offers');
  });

  it('produto "soon" fica desabilitado, com chip "Em breve" e sem navegação', () => {
    const onToggle = vi.fn();
    render(<ProductNavItem product={soonProduct} expanded={false} idPrefix="desktop" onToggle={onToggle} onNavigate={() => undefined} />);
    const row = screen.getByRole('button', { name: new RegExp(soonProduct.label) });
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Em breve')).toBeTruthy();
    fireEvent.click(row);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
