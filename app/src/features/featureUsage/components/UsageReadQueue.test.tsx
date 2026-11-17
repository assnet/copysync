import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { AdminUsagePage } from '@/pages/admin/AdminUsagePage';
import { apiClient } from '@/services/apiClient';
import { resetUsageReadQueue } from '@/services/adminUsage.service';
import { USAGE_FEATURE_ROUTE, USAGE_PATH, usageFeaturePath } from '../paths';
import { featureUsageStrings as S } from '../strings';
import { detailFixture, summaryFixture } from '../testFixtures';

/**
 * Rede de verdade até o `apiClient`: o mock conta leituras de uso em voo e falha se houver duas ao mesmo tempo
 * (a fila de `adminUsage.service` é quem garante uma por vez por aba).
 */
vi.mock('@/services/serverClock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/serverClock')>()),
  serverNow: () => Date.UTC(2026, 10, 18, 1, 0, 0),
}));
vi.mock('@mui/x-charts/LineChart', () => ({ LineChart: () => <div data-testid="line-chart" /> }));
vi.mock('@/services/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/apiClient')>()),
  apiClient: { get: vi.fn() },
}));

const get = vi.mocked(apiClient.get);
let inFlight = 0;
let overlaps = 0;
let calls: string[] = [];
let delayMs = 15;
/** Respostas atrasadas de um caso anterior não mexem na contagem do caso atual. */
let generation = 0;
/** Com lista, as respostas só saem quando o caso solta (`releaseAll`). */
let held: (() => void)[] | null = null;
const releaseAll = () => { const list = held ?? []; held = null; list.forEach((fn) => fn()); };

function respond(url: string): unknown {
  if (url === '/admin/usage/summary') return summaryFixture();
  if (url.endsWith('/tenants')) return { items: [], nextCursor: null };
  const detail = detailFixture();
  const key = decodeURIComponent(url.split('/').pop() ?? '');
  return { ...detail, feature: { ...detail.feature, key } };
}

let navigate: NavigateFunction;
function NavProbe() {
  navigate = useNavigate();
  return null;
}

function renderPage(path: string, strict = false) {
  const tree = (
    <MemoryRouter initialEntries={[path]}>
      <NavProbe />
      <Routes>
        <Route path={USAGE_PATH} element={<AdminUsagePage />} />
        <Route path={USAGE_FEATURE_ROUTE} element={<AdminUsagePage />} />
      </Routes>
    </MemoryRouter>
  );
  return renderWithTheme(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const idle = () => waitFor(() => expect(inFlight).toBe(0));

beforeEach(() => {
  window.sessionStorage.clear();
  resetUsageReadQueue();
  inFlight = 0;
  overlaps = 0;
  generation += 1;
  calls = [];
  delayMs = 120;
  get.mockReset();
  get.mockImplementation(((url: string, config?: { params?: Record<string, string> }) => {
    const gen = generation;
    inFlight += 1;
    if (inFlight > 1) { overlaps += 1; throw new Error(`duas leituras de uso em voo: ${url}`); }
    calls.push(`${url}?${new URLSearchParams(config?.params ?? {}).toString()}`);
    return new Promise((resolve) => {
      const finish = () => {
        if (gen === generation) inFlight -= 1;
        resolve({ data: { data: respond(url) } });
      };
      if (held) held.push(finish);
      else setTimeout(finish, delayMs);
    });
  }) as unknown as typeof apiClient.get);
});

afterEach(async () => {
  expect(overlaps).toBe(0);
  await idle();
  resetUsageReadQueue();
  window.sessionStorage.clear();
});

describe('leituras de uso: uma por vez na rede', () => {
  it('troca rápida de filtro: superados não vão à rede, o último vai', async () => {
    const user = userEvent.setup();
    renderPage(USAGE_PATH);
    await screen.findByText(S.kpis.activeTenants.value('9', '15'));
    await idle();
    calls = [];
    held = [];
    await user.click(screen.getByRole('button', { name: S.filters.presets['7d'] }));
    await user.click(screen.getByRole('button', { name: S.filters.presets['90d'] }));
    await user.click(screen.getByRole('button', { name: S.filters.presets.today }));
    // Só o 7d foi à rede; 90d ficou na fila e foi superado pelo "Hoje".
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('from=2026-11-11');
    act(() => releaseAll());
    await idle();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('from=2026-11-17&to=2026-11-17');
  });

  it('visão geral → detalhe → voltar sem esperar', async () => {
    renderPage(USAGE_PATH);
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => { navigate(usageFeaturePath('offer_hunter')); });
    act(() => { navigate(USAGE_PATH); });
    await screen.findByText(S.kpis.activeTenants.value('9', '15'));
    await idle();
  });

  it('recurso A → B: o detalhe de A ainda na fila não vai à rede', async () => {
    renderPage(USAGE_PATH);
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => { navigate(usageFeaturePath('offer_hunter')); });
    act(() => { navigate(usageFeaturePath('offer_generator')); });
    await screen.findByRole('heading', { name: 'Gerador de ofertas' });
    await idle();
    expect(calls.some((c) => c.startsWith('/admin/usage/features/offer_hunter?'))).toBe(false);
    expect(calls.some((c) => c.startsWith('/admin/usage/features/offer_generator?'))).toBe(true);
  });

  it('tendência só depois do resumo, inclusive no "Atualizar"', async () => {
    window.sessionStorage.setItem('ui.usage.trendFeature', JSON.stringify({ v: 1, d: 'offer_hunter' }));
    const user = userEvent.setup();
    renderPage(USAGE_PATH);
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]).toMatch(/^\/admin\/usage\/summary\?/);
    expect(calls[1]).toMatch(/^\/admin\/usage\/features\/offer_hunter\?/);
    await idle();
    calls = [];
    await user.click(screen.getByRole('button', { name: S.actions.refreshAria }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]).toMatch(/^\/admin\/usage\/summary\?/);
    expect(calls[1]).toMatch(/^\/admin\/usage\/features\/offer_hunter\?/);
    await idle();
  });

  it('StrictMode: o duplo efeito do mount não duplica leitura', async () => {
    renderPage(USAGE_PATH, true);
    await screen.findByText(S.kpis.activeTenants.value('9', '15'));
    await idle();
    expect(calls.filter((c) => c.startsWith('/admin/usage/summary?'))).toHaveLength(1);
    calls = [];
    act(() => { navigate(usageFeaturePath('offer_hunter')); });
    await screen.findByText(S.tenants.empty);
    await idle();
    expect(calls.filter((c) => c.startsWith('/admin/usage/features/offer_hunter?'))).toHaveLength(1);
    expect(calls.filter((c) => c.includes('/tenants?'))).toHaveLength(1);
  });
});
