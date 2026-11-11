import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PlanLimitBanner } from '../components/PlanLimitBanner';
import { nextPlanFor, plansAbove, upgradePathFor } from '../planUpsell';
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
    expect(nextPlanFor('groups', 3)).toEqual({ name: 'PRO', limit: 5 });
    expect(nextPlanFor('groups', 5)).toEqual({ name: 'MAX', limit: 10 });
    expect(nextPlanFor('groups', 10)).toBeNull();
    expect(nextPlanFor('rotations', 1)).toEqual({ name: 'MAX', limit: 2 });
    expect(nextPlanFor('rotations', 2)).toBeNull();
  });

  it('grupos por canal: Telegram parte do zero no LITE', () => {
    expect(nextPlanFor('telegramMonitoredGroups', 0)).toEqual({ name: 'PRO', limit: 2 });
    expect(nextPlanFor('telegramBroadcastGroups', 10)).toEqual({ name: 'MAX', limit: 40 });
    expect(nextPlanFor('whatsappMonitoredGroups', 1)).toEqual({ name: 'PRO', limit: 2 });
    expect(nextPlanFor('whatsappBroadcastGroups', 5)).toEqual({ name: 'PRO', limit: 10 });
    expect(nextPlanFor('whatsappBroadcastGroups', 40)).toBeNull();
  });

  it('textos de grupos por canal com plural e canal', () => {
    expect(t.nextPlan('PRO', 2, 'telegramMonitoredGroups')).toBe('No PRO são 2 grupos monitorados no Telegram.');
    expect(t.topPlanBody(40, 'whatsappBroadcastGroups')).toBe('Você já usa o máximo de 40 grupos de disparo no WhatsApp. Para incluir outro, remova um grupo que não usa mais.');
  });
});

describe('plansAbove', () => {
  it('todos os planos com limite maior, em ordem', () => {
    expect(plansAbove('mercadoLivreTags', 1)).toEqual([{ name: 'PRO', limit: 2 }, { name: 'MAX', limit: 10 }]);
    expect(plansAbove('mercadoLivreTags', 2)).toEqual([{ name: 'MAX', limit: 10 }]);
    expect(plansAbove('mercadoLivreTags', 10)).toEqual([]);
    expect(plansAbove('groups', 3)).toEqual([{ name: 'PRO', limit: 5 }, { name: 'MAX', limit: 10 }]);
  });

  it('CTA com ?feature= só para o kind que tem aviso na vitrine', () => {
    expect(upgradePathFor('mercadoLivreTags')).toBe('/affiliates/plans?feature=mercadoLivreTags');
    expect(upgradePathFor('groups')).toBe('/affiliates/plans');
  });
});

describe('PlanLimitBanner — etiquetas do Mercado Livre', () => {
  const showTags = (limit: number, mode: 'light' | 'dark' = 'light') =>
    renderWithTheme(<MemoryRouter><PlanLimitBanner open onClose={vi.fn()} kind="mercadoLivreTags" limit={limit} /></MemoryRouter>, mode);

  it('LITE: lista PRO e MAX e leva aos planos com o recurso destacado', () => {
    showTags(1, 'dark');
    const offers = [{ name: 'PRO', limit: 2 }, { name: 'MAX', limit: 10 }];
    expect(screen.getByText(t.title('mercadoLivreTags'))).toBeInTheDocument();
    expect(screen.getByText(t.body(1, 'mercadoLivreTags'))).toBeInTheDocument();
    expect(screen.getByRole('img', { name: t.compareAllAria(1, offers, 'mercadoLivreTags') })).toBeInTheDocument();
    expect(screen.getByText('PRO')).toBeInTheDocument();
    expect(screen.getByText('MAX')).toBeInTheDocument();
    expect(screen.getByText(t.allPlans(offers, 'mercadoLivreTags'))).toBeInTheDocument();
    expect(t.allPlans(offers, 'mercadoLivreTags')).toBe('No PRO são 2 etiquetas e no MAX, 10.');
    expect(screen.getByRole('link', { name: t.cta })).toHaveAttribute('href', '/affiliates/plans?feature=mercadoLivreTags');
  });

  it('PRO cheio: só o MAX', () => {
    showTags(2);
    expect(screen.getByText(t.nextPlan('MAX', 10, 'mercadoLivreTags'))).toBeInTheDocument();
    expect(screen.queryByText('PRO')).not.toBeInTheDocument();
  });

  it('MAX cheio: sem upgrade, orienta a desvincular', () => {
    showTags(10);
    expect(screen.getByText(t.topPlanBody(10, 'mercadoLivreTags'))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: t.cta })).not.toBeInTheDocument();
  });
});

describe('PlanLimitBanner', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('grupos: mostra o próximo plano, o número e o CTA para /plans', () => {
    show('groups', 3, 'dark');
    expect(screen.getByText(t.groupsTitle)).toBeInTheDocument();
    expect(screen.getByText(t.nextPlan('PRO', 5, 'groups'))).toBeInTheDocument();
    expect(screen.getByRole('img', { name: t.compareAria(3, 'PRO', 5, 'groups') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.cta })).toHaveAttribute('href', '/affiliates/plans');
    expect(screen.getByRole('button', { name: t.dismiss })).toBeInTheDocument();
  });

  it('rodízios: próximo plano com mais links', () => {
    show('rotations', 1);
    expect(screen.getByText(t.rotationsTitle)).toBeInTheDocument();
    expect(screen.getByText(t.nextPlan('MAX', 2, 'rotations'))).toBeInTheDocument();
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
