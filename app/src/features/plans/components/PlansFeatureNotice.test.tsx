import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlansFeatureNotice } from './PlansFeatureNotice';
import { plansStrings } from '../strings';

describe('PlansFeatureNotice', () => {
  it('mostra o aviso com feature=storefront', () => {
    render(<PlansFeatureNotice feature="storefront" />);
    expect(screen.getByRole('alert').textContent).toContain(plansStrings.featureNotice.storefront);
  });

  it('some sem feature ou com feature desconhecida', () => {
    const { container, rerender } = render(<PlansFeatureNotice feature={null} />);
    expect(container.innerHTML).toBe('');
    rerender(<PlansFeatureNotice feature="outra" />);
    expect(container.innerHTML).toBe('');
  });
});
