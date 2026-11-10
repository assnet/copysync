import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Clock } from 'lucide-react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { MonitorCard } from './MonitorCard';

const card = (collapseKey?: string) => (
  <MonitorCard icon={Clock} title="Horário" subtitle="Quando postar" collapseKey={collapseKey}>
    <button type="button">Conteúdo</button>
  </MonitorCard>
);

beforeEach(() => localStorage.clear());

describe('MonitorCard', () => {
  it('sem collapseKey: conteúdo visível e cabeçalho não é botão', () => {
    renderWithTheme(card());
    expect(screen.getByRole('button', { name: 'Conteúdo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Horário/ })).not.toBeInTheDocument();
  });

  it('recolhível nasce fechado com conteúdo montado; clique alterna aria-expanded', () => {
    renderWithTheme(card('window'));
    const header = screen.getByRole('button', { name: /Horário/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Conteúdo' })).not.toBeInTheDocument();
    expect(screen.getByText('Conteúdo')).toBeInTheDocument(); // montado, só escondido
    expect(document.getElementById(header.getAttribute('aria-controls')!)).not.toBeNull();

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Conteúdo' })).toBeInTheDocument();
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });

  it('aberto/fechado persiste no navegador e volta ao remontar', () => {
    const { unmount } = renderWithTheme(card('window'));
    fireEvent.click(screen.getByRole('button', { name: /Horário/ }));
    expect(JSON.parse(localStorage.getItem('ui.monitoring.card.window')!)).toEqual({ v: 0, d: true });
    expect(sessionStorage.getItem('ui.monitoring.card.window')).toBeNull();
    unmount();

    renderWithTheme(card('window'));
    expect(screen.getByRole('button', { name: /Horário/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Conteúdo' })).toBeInTheDocument();
  });

  it('cada chave guarda o próprio estado', () => {
    localStorage.setItem('ui.monitoring.card.text', JSON.stringify({ v: 0, d: true }));
    renderWithTheme(card('window'));
    expect(screen.getByRole('button', { name: /Horário/ })).toHaveAttribute('aria-expanded', 'false');
  });
});
