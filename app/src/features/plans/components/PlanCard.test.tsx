import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PLAN_CATALOG } from '../catalog';
import { buildCheckoutUrl } from '../checkout';
import { plansStrings as t } from '../strings';
import { PlanCard } from './PlanCard';

const max = PLAN_CATALOG.find((p) => p.slug === 'max')!;
const url = buildCheckoutUrl('max', 'annual', '', PLAN_CATALOG, { email: 'ana@x.com', confirmEmail: 'ana@x.com', name: 'Ana' })!;

afterEach(() => vi.restoreAllMocks());

describe('PlanCard', () => {
  it.each(['light', 'dark'] as const)('"Assinar" é botão sem href, com nome acessível de nova aba (%s)', (mode) => {
    renderWithTheme(<PlanCard plan={max} period="annual" getCheckoutUrl={() => url} />, mode);
    const button = screen.getByRole('button', { name: t.card.ctaNewTab(max.name) });
    expect(button.tagName).toBe('BUTTON');
    expect(button).not.toHaveAttribute('href');
    expect(button).toHaveTextContent(t.card.cta(max.name));
    expect(screen.queryByRole('link', { name: t.card.ctaNewTab(max.name) })).toBeNull();
  });

  it('clique abre a URL montada em nova aba e isola o opener', () => {
    const tab = { opener: {} as unknown };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as Window);
    const getUrl = vi.fn(() => url);
    renderWithTheme(<PlanCard plan={max} period="annual" getCheckoutUrl={getUrl} />);
    expect(getUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t.card.ctaNewTab(max.name) }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(url, '_blank');
    expect(tab.opener).toBeNull();
  });

  it('pop-up bloqueado (null) → abre na própria aba', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as Location);
    renderWithTheme(<PlanCard plan={max} period="annual" getCheckoutUrl={() => url} />);
    fireEvent.click(screen.getByRole('button', { name: t.card.ctaNewTab(max.name) }));
    expect(assign).toHaveBeenCalledWith(url);
  });

  it.each([['lite', '1 etiqueta'], ['pro', '2 etiquetas'], ['max', '10 etiquetas']] as const)(
    'mostra o limite de etiquetas do Mercado Livre do %s abaixo da tabela, com dica', (slug, text) => {
      const plan = PLAN_CATALOG.find((p) => p.slug === slug)!;
      renderWithTheme(<PlanCard plan={plan} period="monthly" getCheckoutUrl={() => url} />);
      const row = screen.getByTestId('plan-ml-tags');
      expect(t.mercadoLivreTags.value(plan.limits.mercadoLivreTags)).toBe(text);
      expect(row).toHaveTextContent(t.mercadoLivreTags.label);
      expect(row).toHaveTextContent(text);
      expect(row).toHaveAccessibleDescription(t.mercadoLivreTags.hint);
      const table = screen.getByRole('table');
      expect(table.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    },
  );
});
