import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavItemBadge, NavItemTooltip } from './NavItemBadge';

describe('NavItemBadge', () => {
  it('renderiza o selo quando há badge', () => {
    render(<NavItemBadge badge="Profissional" />);
    expect(screen.getByText('Profissional')).toBeTruthy();
  });

  it('não renderiza nada sem badge', () => {
    const { container } = render(<NavItemBadge />);
    expect(container.innerHTML).toBe('');
  });

  it('título do tooltip recolhido leva o selo junto do rótulo', () => {
    render(<NavItemTooltip label="Página de Ofertas" badge="Profissional" />);
    expect(screen.getByText('Página de Ofertas')).toBeTruthy();
    expect(screen.getByText('Profissional')).toBeTruthy();
  });
});
