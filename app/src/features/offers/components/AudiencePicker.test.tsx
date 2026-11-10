import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { AudiencePicker } from './AudiencePicker';

describe('AudiencePicker e "Reescrita com IA" por plano', () => {
  it.each(['light', 'dark'] as const)('%s: travado, só Padrão selecionável; salvo não-Padrão vale como Padrão; selos e aviso', (mode) => {
    const onChange = vi.fn();
    renderWithTheme(<AudiencePicker value="MOMS" onChange={onChange} label="Público-alvo" aiLocked />, mode);
    const group = screen.getByRole('radiogroup', { name: 'Público-alvo' });
    const standard = within(group).getByRole('radio', { name: /Padrão/ });
    const moms = within(group).getByRole('radio', { name: /Mães/ });
    expect(standard).toHaveAttribute('aria-checked', 'true');
    expect(moms).toHaveAttribute('aria-checked', 'false');
    expect(moms).toBeDisabled();
    expect(moms).toHaveAttribute('aria-disabled', 'true');
    expect(standard).toBeEnabled();
    fireEvent.click(moms);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Disponível nos planos PRO e MAX.')).toBeInTheDocument();
    expect(screen.getByLabelText('Disponível nos planos PRO e MAX')).toBeInTheDocument();
    expect(group).toHaveAccessibleDescription('Disponível nos planos PRO e MAX.');
  });

  it('liberado: todos os públicos habilitados, sem aviso', () => {
    const onChange = vi.fn();
    renderWithTheme(<AudiencePicker value="MOMS" onChange={onChange} label="Público-alvo" />);
    const moms = screen.getByRole('radio', { name: /Mães/ });
    expect(moms).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /Fitness/ }));
    expect(onChange).toHaveBeenCalledWith('FITNESS');
    expect(screen.queryByText('Disponível nos planos PRO e MAX.')).not.toBeInTheDocument();
  });
});
