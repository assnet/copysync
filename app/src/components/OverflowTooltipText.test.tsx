import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OverflowTooltipText } from './OverflowTooltipText';
import { isElementTruncated } from './useIsTruncated';

/** jsdom não faz layout: simula a largura do conteúdo e da caixa. */
function mockWidths(scrollWidth: number, clientWidth: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth);
}

afterEach(() => vi.restoreAllMocks());

describe('isElementTruncated', () => {
  it('só é cortado quando o conteúdo passa da largura', () => {
    const el = document.createElement('p');
    mockWidths(200, 100);
    expect(isElementTruncated(el)).toBe(true);
    mockWidths(100, 100);
    expect(isElementTruncated(el)).toBe(false);
    expect(isElementTruncated(null)).toBe(false);
  });
});

describe('OverflowTooltipText', () => {
  const name = 'Grupo de ofertas com um nome muito comprido';

  it('cortado: mostra o nome completo no hover e aceita foco', async () => {
    mockWidths(300, 100);
    render(<OverflowTooltipText text={name} />);
    const line = screen.getByText(name);
    expect(line).toHaveAttribute('tabindex', '0');
    await userEvent.hover(line);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(name);
  });

  it('cabe inteiro: sem tooltip e sem parada de foco', async () => {
    mockWidths(100, 100);
    render(<OverflowTooltipText text={name} />);
    const line = screen.getByText(name);
    expect(line).not.toHaveAttribute('tabindex');
    await userEvent.hover(line);
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('borrar ligado: nunca mostra o tooltip', async () => {
    mockWidths(300, 100);
    render(<OverflowTooltipText text={name} disabled />);
    await userEvent.hover(screen.getByText(name));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('dentro de área clicável não cria parada de foco própria', () => {
    mockWidths(300, 100);
    render(<OverflowTooltipText text={name} focusable={false} />);
    expect(screen.getByText(name)).not.toHaveAttribute('tabindex');
  });
});
