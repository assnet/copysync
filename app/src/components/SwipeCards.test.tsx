import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SwipeCards, nearestCardIndex, type SwipeCardsItem } from './SwipeCards';

const items: SwipeCardsItem[] = [
  { key: 'a', label: 'Shopee', status: 'done', content: <div>Card A</div> },
  { key: 'b', label: 'Mercado Livre', status: 'pending', content: <div>Card B</div> },
  { key: 'c', label: 'Amazon', status: 'paused', content: <div>Card C</div> },
];

/** `useMediaQuery` do MUI lê `matchMedia`: `max-width` casa no mobile. */
function stubViewport(mobile: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: mobile && query.includes('max-width'),
    media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('nearestCardIndex', () => {
  it('escolhe o card com centro mais próximo do centro do trilho', () => {
    expect(nearestCardIndex(150, [100, 300, 500])).toBe(0);
    expect(nearestCardIndex(260, [100, 300, 500])).toBe(1);
    expect(nearestCardIndex(900, [100, 300, 500])).toBe(2);
  });
});

describe('SwipeCards', () => {
  it('desktop: renderiza a grade e nenhum carrossel', () => {
    stubViewport(false);
    const renderGrid = vi.fn(() => <div>GRADE</div>);
    render(<SwipeCards items={items} ariaLabel="Planos" renderGrid={renderGrid} />);
    expect(renderGrid).toHaveBeenCalledWith(items);
    expect(screen.getByText('GRADE')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Planos' })).not.toBeInTheDocument();
  });

  it('mobile: cards acessíveis, indicadores com aria-current e card inicial', () => {
    stubViewport(true);
    const renderGrid = vi.fn();
    render(<SwipeCards items={items} initialKey="b" ariaLabel="Planos" renderGrid={renderGrid} />);
    expect(renderGrid).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Planos' })).toHaveAttribute('aria-roledescription', 'carrossel');
    expect(screen.getByRole('group', { name: 'Shopee, 1 de 3' })).toHaveAttribute('aria-roledescription', 'card');
    expect(screen.getByRole('group', { name: 'Amazon, 3 de 3' })).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[1]).toHaveAttribute('aria-current', 'true');
    expect(buttons[0]).not.toHaveAttribute('aria-current');
    expect(buttons[0]).toHaveTextContent('Shopee, configurado');
    expect(buttons[1]).toHaveTextContent('Mercado Livre, pendente');
    expect(buttons[2]).toHaveTextContent('Amazon, pausado');
  });

  it('mobile: clique no indicador rola o trilho e ativa o card', () => {
    stubViewport(true);
    render(<SwipeCards items={items} ariaLabel="Planos" renderGrid={() => null} />);
    const track = screen.getByRole('group', { name: 'Planos' });
    const scrollTo = vi.fn();
    Object.defineProperty(track, 'scrollTo', { value: scrollTo, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: /Amazon/ }));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    expect(screen.getByRole('button', { name: /Amazon/ })).toHaveAttribute('aria-current', 'true');
  });

  it('mobile: setas no trilho trocam de card', () => {
    stubViewport(true);
    render(<SwipeCards items={items} ariaLabel="Planos" renderGrid={() => null} />);
    const track = screen.getByRole('group', { name: 'Planos' });
    fireEvent.keyDown(track, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: /Mercado Livre/ })).toHaveAttribute('aria-current', 'true');
    fireEvent.keyDown(track, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { name: /Shopee/ })).toHaveAttribute('aria-current', 'true');
  });

  it('mobile: seta vinda de um controle dentro do card não troca o card', () => {
    stubViewport(true);
    const withButton = [{ ...items[0], content: <button>Interno</button> }, items[1]];
    render(<SwipeCards items={withButton} ariaLabel="Planos" renderGrid={() => null} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Interno' }), { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: /Shopee/ })).toHaveAttribute('aria-current', 'true');
  });

  it('mobile: ativo é clampado quando a lista encolhe', () => {
    stubViewport(true);
    const { rerender } = render(<SwipeCards items={items} initialKey="c" ariaLabel="Planos" renderGrid={() => null} />);
    expect(screen.getByRole('button', { name: /Amazon/ })).toHaveAttribute('aria-current', 'true');
    rerender(<SwipeCards items={items.slice(0, 2)} initialKey="c" ariaLabel="Planos" renderGrid={() => null} />);
    expect(screen.getByRole('button', { name: /Mercado Livre/ })).toHaveAttribute('aria-current', 'true');
  });
});
