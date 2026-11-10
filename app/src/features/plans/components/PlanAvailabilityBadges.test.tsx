import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PlanAvailabilityBadges, plansIn } from './PlanAvailabilityBadges';

describe('PlanAvailabilityBadges', () => {
  it('forma antiga `from` segue mostrando a partir do plano', () => {
    renderWithTheme(<PlanAvailabilityBadges from="pro" />);
    expect(screen.getByText('PRO')).toBeInTheDocument();
    expect(screen.getByText('MAX')).toBeInTheDocument();
    expect(screen.queryByText('LITE')).not.toBeInTheDocument();
  });

  it('lista vinda da API, na ordem da vitrine', () => {
    renderWithTheme(<PlanAvailabilityBadges plans={['max', 'lite']} />, 'dark');
    expect(screen.getByText('LITE')).toBeInTheDocument();
    expect(screen.getByText('MAX')).toBeInTheDocument();
    expect(screen.queryByText('PRO')).not.toBeInTheDocument();
    expect(plansIn(['max', 'lite'])).toEqual(['LITE', 'MAX']);
  });

  it('lista vazia não renderiza selo', () => {
    const { container } = renderWithTheme(<PlanAvailabilityBadges plans={[]} />);
    expect(container.querySelector('.MuiChip-root')).toBeNull();
  });
});
