import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SectionCard } from './SectionCard';

beforeEach(() => localStorage.clear());

describe('SectionCard', () => {
  it('sem collapseKey: conteúdo visível e título não é botão', () => {
    render(<SectionCard title="Fila">conteúdo</SectionCard>);
    expect(screen.getByText('conteúdo')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Fila/ })).not.toBeInTheDocument();
  });

  it('com collapseKey: nasce recolhido, abre no clique, lembra no navegador e a ação segue clicável', () => {
    const onAction = vi.fn();
    const { unmount } = render(
      <SectionCard title="Fila" collapseKey="test.card" action={<button onClick={onAction}>Pausar</button>}>conteúdo</SectionCard>,
    );
    const header = screen.getByRole('button', { name: /Fila/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    expect(onAction).toHaveBeenCalled();
    expect(header).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(localStorage.getItem('ui.test.card')!)).toEqual({ v: 0, d: true });
    unmount();
    render(<SectionCard title="Fila" collapseKey="test.card">conteúdo</SectionCard>);
    expect(screen.getByRole('button', { name: /Fila/ })).toHaveAttribute('aria-expanded', 'true');
  });
});
