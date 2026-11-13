import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommissionFilterField } from './CommissionFilterField';

describe('CommissionFilterField', () => {
  it('valor legado acima de 50: rótulo com o valor real, barra presa em 50 e aviso', () => {
    render(<CommissionFilterField filters={{ minCommissionPct: 60, commissionOperator: 'GT' }} onChange={vi.fn()} />);
    expect(screen.getByText('> 60%')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Percentual da comissão de 1ª compra' })).toHaveValue('50');
    expect(screen.getByTestId('commission-help')).toHaveTextContent('Valor salvo 60% acima do limite de 50%: ajuste para salvar.');
  });

  it('valor dentro do limite: barra no valor e dica normal', () => {
    render(<CommissionFilterField filters={{ minCommissionPct: 20, commissionOperator: 'GT' }} onChange={vi.fn()} />);
    expect(screen.getByRole('slider', { name: 'Percentual da comissão de 1ª compra' })).toHaveValue('20');
    expect(screen.getByTestId('commission-help')).toHaveTextContent('Use um valor de 0 a 50.');
  });
});
