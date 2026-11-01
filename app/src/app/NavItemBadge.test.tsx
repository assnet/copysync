import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavItemBadge, NavItemTooltip } from './NavItemBadge';

describe('NavItemBadge', () => {
  it('renderiza o selo quando há badge', () => {
    render(<NavItemBadge badge="PRO" />);
    expect(screen.getByText('PRO')).toBeTruthy();
  });

  it('empilhado vai sem recuo lateral, abaixo do rótulo', () => {
    render(<NavItemBadge badge="PRO" stacked />);
    const chip = screen.getByText('PRO').closest('.MuiChip-root') as HTMLElement;
    expect(getComputedStyle(chip).marginLeft).not.toBe('8px');
  });

  it('não renderiza nada sem badge', () => {
    const { container } = render(<NavItemBadge />);
    expect(container.innerHTML).toBe('');
  });

  it('título do tooltip recolhido leva o selo junto do rótulo', () => {
    render(<NavItemTooltip label="Página de Ofertas" badge="PRO" />);
    expect(screen.getByText('Página de Ofertas')).toBeTruthy();
    expect(screen.getByText('PRO')).toBeTruthy();
  });
});
