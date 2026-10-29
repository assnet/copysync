import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PlanLimitBanner } from '../components/PlanLimitBanner';
import { nextPlanFor } from '../planUpsell';
import { linkRotationStrings } from '../strings';

const t = linkRotationStrings.upgrade;

const show = (kind: 'rotations' | 'groups', limit: number, mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(<MemoryRouter><PlanLimitBanner open onClose={vi.fn()} kind={kind} limit={limit} /></MemoryRouter>, mode);

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}

describe('nextPlanFor', () => {
  it('próximo plano pelo catálogo', () => {
    expect(nextPlanFor('groups', 3)).toEqual({ name: 'Profissional', limit: 5 });
    expect(nextPlanFor('groups', 5)).toEqual({ name: 'Business', limit: 10 });
    expect(nextPlanFor('groups', 10)).toBeNull();
    expect(nextPlanFor('rotations', 1)).toEqual({ name: 'Business', limit: 2 });
    expect(nextPlanFor('rotations', 2)).toBeNull();
  });
});

describe('PlanLimitBanner', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('grupos: mostra o próximo plano, o número e o CTA para /plans', () => {
    show('groups', 3, 'dark');
    expect(screen.getByText(t.groupsTitle)).toBeInTheDocument();
    expect(screen.getByText(t.nextPlan('Profissional', 5, 'groups'))).toBeInTheDocument();
    expect(screen.getByRole('img', { name: t.compareAria(3, 'Profissional', 5, 'groups') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.cta })).toHaveAttribute('href', '/plans');
    expect(screen.getByRole('button', { name: t.dismiss })).toBeInTheDocument();
  });

  it('rodízios: próximo plano com mais links', () => {
    show('rotations', 1);
    expect(screen.getByText(t.rotationsTitle)).toBeInTheDocument();
    expect(screen.getByText(t.nextPlan('Business', 2, 'rotations'))).toBeInTheDocument();
  });

  it('no maior plano não oferece upgrade', () => {
    show('groups', 10);
    expect(screen.getByText(t.topPlanTitle)).toBeInTheDocument();
    expect(screen.getByText(t.topPlanBody(10, 'groups'))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: t.cta })).not.toBeInTheDocument();
  });

  it('com movimento: confete na entrada', () => {
    stubReducedMotion(false);
    show('groups', 3);
    expect(screen.getAllByTestId('plan-limit-confetti').length).toBeGreaterThan(0);
  });

  it('prefers-reduced-motion: sem confete nem brilho', () => {
    stubReducedMotion(true);
    const { baseElement } = show('groups', 3);
    expect(screen.queryByTestId('plan-limit-confetti')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-limit-shine')).not.toBeInTheDocument();
    expect(baseElement.querySelector('[data-motion="reduced"]')).not.toBeNull();
  });
});
