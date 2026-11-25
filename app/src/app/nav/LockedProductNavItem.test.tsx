import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { buildNavigation } from '@/features/navigation';
import { renderWithTheme } from '@/test/renderWithTheme';
import { ProductNavItem } from './ProductNavItem';
import { CollapsedProductNavItem } from './CollapsedProductNavItem';

const locked = buildNavigation({ isSuperAdmin: false, offerHunterVisible: false, watermarkVisible: false, saverVisible: false, products: ['SAVER'] }).products[0];

describe('produto travado no menu', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`cadeado, foco por teclado e só a vitrine ao expandir (${mode})`, () => {
      const onToggle = vi.fn();
      const onNavigate = vi.fn();
      const { rerender } = renderWithTheme(
        <ProductNavItem product={locked} expanded={false} idPrefix="desktop" onToggle={onToggle} onNavigate={onNavigate} />,
        mode,
      );
      const row = screen.getByRole('button', { name: 'Afiliados: fora do seu plano' });
      expect(screen.getByTestId('nav-product-lock')).toBeInTheDocument();
      row.focus();
      expect(row).toHaveFocus();
      fireEvent.click(row);
      expect(onToggle).toHaveBeenCalledWith('affiliates');

      rerender(<ProductNavItem product={locked} expanded idPrefix="desktop" onToggle={onToggle} onNavigate={onNavigate} />);
      expect(screen.queryByText('Gerador de ofertas')).toBeNull();
      fireEvent.click(screen.getByText('Planos'));
      expect(onNavigate).toHaveBeenCalledWith('/affiliates/plans');
    });
  }

  it('recolhido: cadeado no ícone e nome acessível de travado (escuro)', () => {
    renderWithTheme(<CollapsedProductNavItem product={locked} onNavigate={() => undefined} />, 'dark');
    expect(screen.getByRole('button', { name: 'Afiliados: fora do seu plano' })).toBeInTheDocument();
    expect(screen.getByTestId('nav-product-lock')).toBeInTheDocument();
  });

  it('produto liberado não mostra cadeado', () => {
    const open = buildNavigation({ isSuperAdmin: false, offerHunterVisible: false, watermarkVisible: false, saverVisible: false, products: ['AFFILIATES'] }).products[0];
    renderWithTheme(<ProductNavItem product={open} expanded={false} idPrefix="mobile" onToggle={() => undefined} onNavigate={() => undefined} />);
    expect(screen.queryByTestId('nav-product-lock')).toBeNull();
  });
});
