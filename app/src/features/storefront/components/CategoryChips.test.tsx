import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { CategoryChips } from './CategoryChips';

const categories = [
  { key: 'casa', label: 'Casa' },
  { key: 'pet', label: 'Pet Shop' },
];

describe('CategoryChips', () => {
  it('cada chip é botão com aria-pressed refletindo a escolha', () => {
    renderWithTheme(<CategoryChips categories={categories} value={['pet']} onChange={() => {}} />, 'dark');
    expect(screen.getByRole('button', { name: 'Casa' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Pet Shop' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { pressed: true })).toHaveTextContent('Pet Shop');
  });

  it('alternar mantém a ordem do catálogo', () => {
    const onChange = vi.fn();
    renderWithTheme(<CategoryChips categories={categories} value={['pet']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Casa' }));
    expect(onChange).toHaveBeenCalledWith(['casa', 'pet']);
  });
});
