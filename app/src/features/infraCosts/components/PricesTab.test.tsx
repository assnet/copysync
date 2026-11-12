import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { readPersisted } from '@/hooks/usePersistedState';
import { AdminCostsPage, activeCostsTab } from '@/pages/admin/AdminCostsPage';
import { adminCostsService } from '@/services/adminCosts.service';
import { infraCostsStrings as S } from '../strings';
import { sampleSettings } from '../testFixtures';
import type { InfraCostSettings, InfraCostSettingsView } from '../types';
import { COST_PRICES_DRAFT_KEY, type CostPricesDraftState } from '../useCostSettings';
import PricesTab, { COST_PRICES_OPEN_ITEMS_KEY } from './PricesTab';

const p = S.prices;
const view = (over: Partial<InfraCostSettingsView> = {}): InfraCostSettingsView => ({
  settings: sampleSettings(), origin: 'saved', updatedAt: '2026-11-01T10:00:00.000Z', ...over,
});

const box = (name: string) => screen.getByRole('textbox', { name });

async function setText(user: ReturnType<typeof userEvent.setup>, name: string, value: string) {
  const input = box(name);
  await user.clear(input);
  if (value) await user.type(input, value);
}

const renderTab = (mode: 'light' | 'dark' = 'light') => renderWithTheme(<MemoryRouter><PricesTab /></MemoryRouter>, mode);

function saveDraft(state: CostPricesDraftState) {
  sessionStorage.setItem(`ui.${COST_PRICES_DRAFT_KEY}`, JSON.stringify({ v: 0, d: state }));
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('PricesTab', () => {
  it.each(['light', 'dark'] as const)('mostra seções, cotação automática desabilitada com aviso da próxima versão (%s)', async (mode) => {
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view());
    renderTab(mode);
    expect(await screen.findByText(p.fx.title)).toBeInTheDocument();
    for (const title of [p.items.title, p.renderPlans.title, p.aiModels.title, p.workspace.title]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    const auto = screen.getByRole('checkbox', { name: new RegExp(p.fx.auto.replace(/[()]/g, '\\$&')) });
    expect(auto).toBeDisabled();
    expect(screen.getByText(p.fx.autoHint)).toBeInTheDocument();
    // Sem alteração: nada a revisar.
    expect(screen.getByRole('button', { name: p.actions.review })).toBeDisabled();
  });

  it('cotação manual: informa valor e data, revisa o diff e salva com expectedUpdatedAt; rascunho limpo', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view());
    const saved: InfraCostSettings = { ...sampleSettings(), fx: { ...sampleSettings().fx, override: { rate: 5.4321, date: '2026-11-10' } } };
    const update = vi.spyOn(adminCostsService, 'updateSettings').mockResolvedValue(view({ settings: saved, updatedAt: '2026-11-12T10:00:00.000Z' }));
    renderTab();
    await user.click(await screen.findByRole('button', { name: p.fx.addOverride }));
    await setText(user, p.fx.rate, '5,4321');
    const date = screen.getByLabelText(p.fx.date);
    await user.clear(date);
    await user.type(date, '2026-11-10');
    expect(readPersisted<CostPricesDraftState>(COST_PRICES_DRAFT_KEY)?.base).toBe('2026-11-01T10:00:00.000Z');

    await user.click(screen.getByRole('button', { name: p.actions.review }));
    const dialog = await screen.findByRole('dialog');
    const rate = within(dialog).getByText(`${p.fx.override} · ${p.fx.rate}`).closest('tr') as HTMLElement;
    expect(rate.textContent).toContain('5,4321');
    expect(within(dialog).getByText(`${p.fx.override} · ${p.fx.date}`)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: p.confirm.save }));

    await waitFor(() => expect(update).toHaveBeenCalledWith({ settings: saved, expectedUpdatedAt: '2026-11-01T10:00:00.000Z' }));
    expect(await screen.findByText(p.saved)).toBeInTheDocument();
    expect(readPersisted(COST_PRICES_DRAFT_KEY)).toBeUndefined();
  });

  it('remover override volta ao estado sem cotação manual e entra no diff', async () => {
    const user = userEvent.setup();
    const withOverride: InfraCostSettings = { ...sampleSettings(), fx: { ...sampleSettings().fx, override: { rate: 5.1, date: '2026-11-05' } } };
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view({ settings: withOverride }));
    renderTab();
    await user.click(await screen.findByRole('button', { name: p.fx.removeOverride }));
    expect(screen.getByText(p.fx.overrideEmpty)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: p.actions.review }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(`${p.fx.override} · ${p.fx.rate}`).closest('tr')?.textContent).toContain('5,1');
  });

  it('rascunho restaurado do sessionStorage aparece no campo, com selo, e pode ser descartado', async () => {
    const user = userEvent.setup();
    const values = sampleSettings();
    values.workspace.planLabel = 'Pro';
    saveDraft({ base: '2026-11-01T10:00:00.000Z', values });
    sessionStorage.setItem(`ui.${COST_PRICES_OPEN_ITEMS_KEY}`, JSON.stringify({ v: 0, d: [0] }));
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view());
    renderTab();
    expect(await screen.findByText(p.draftRestored)).toBeInTheDocument();
    expect(box(p.workspace.planLabel)).toHaveValue('Pro');
    // Item aberto também volta (estado da tela por aba).
    expect(box(p.items.fields.label)).toHaveValue('API');
    await user.click(screen.getByRole('button', { name: p.actions.discard }));
    expect(box(p.workspace.planLabel)).toHaveValue('Hobby');
    expect(readPersisted(COST_PRICES_DRAFT_KEY)).toBeUndefined();
  });

  it('campo inválido marca o erro, conta na seção e bloqueia a revisão', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view());
    renderTab();
    await screen.findByText(p.workspace.title);
    await setText(user, p.workspace.cycleStartDay, '31');
    expect(screen.getByText(S.errors.range('1', '28'))).toBeInTheDocument();
    expect(screen.getAllByText(p.errorsInSection(1)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: p.actions.review })).toBeDisabled();
  });

  it('serviço novo entra aberto, aparece como incluído no diff e removido some', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view());
    renderTab();
    await user.click(await screen.findByRole('button', { name: p.items.add }));
    await setText(user, p.items.fields.label, 'Backup');
    await setText(user, p.items.fields.key, 'backup');
    await setText(user, p.items.fields.monthlyUsd, '3');
    await user.click(screen.getByRole('button', { name: p.actions.review }));
    const dialog = await screen.findByRole('dialog');
    const row = within(dialog).getByText(`${p.items.title} · Backup`).closest('tr') as HTMLElement;
    expect(within(row).getByText(S.diff.added)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: p.confirm.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: p.actions.removeAria('Backup') }));
    expect(screen.queryByRole('textbox', { name: p.items.fields.label })).not.toBeInTheDocument();
  });

  it('400: marca o campo de meta.field e avisa', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view());
    vi.spyOn(adminCostsService, 'updateSettings').mockRejectedValue(
      Object.assign(new Error('x'), { status: 400, code: 'INVALID_INFRA_COST_SETTINGS', field: 'workspace.planLabel' }),
    );
    renderTab();
    await screen.findByText(p.workspace.title);
    await setText(user, p.workspace.planLabel, 'Pro');
    await user.click(screen.getByRole('button', { name: p.actions.review }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: p.confirm.save }));
    expect(await screen.findByText(S.errors.invalid)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText(S.errors.fieldRejected)).toBeInTheDocument();
    expect(box(p.workspace.planLabel)).toHaveAttribute('aria-invalid', 'true');
    // Editar o campo tira o erro da API.
    await user.type(box(p.workspace.planLabel), 'x');
    expect(screen.queryByText(S.errors.fieldRejected)).not.toBeInTheDocument();
  });

  it('409: recarrega o salvo, mantém o rascunho (rebaseado) e avisa', async () => {
    const user = userEvent.setup();
    const newer = sampleSettings();
    newer.workspace.includedBandwidthGb = 100;
    const get = vi.spyOn(adminCostsService, 'getSettings')
      .mockResolvedValueOnce(view())
      .mockResolvedValueOnce(view({ settings: newer, updatedAt: '2026-11-03T10:00:00.000Z' }));
    const update = vi.spyOn(adminCostsService, 'updateSettings')
      .mockRejectedValueOnce(Object.assign(new Error('x'), { status: 409, code: 'INFRA_COST_SETTINGS_CONFLICT' }))
      .mockResolvedValueOnce(view({ updatedAt: '2026-11-04T10:00:00.000Z' }));
    renderTab();
    await screen.findByText(p.workspace.title);
    await setText(user, p.workspace.planLabel, 'Pro');
    await user.click(screen.getByRole('button', { name: p.actions.review }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: p.confirm.save }));

    expect(await screen.findByText(S.errors.conflict)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(box(p.workspace.planLabel)).toHaveValue('Pro');
    const draft = readPersisted<CostPricesDraftState>(COST_PRICES_DRAFT_KEY);
    expect(draft?.base).toBe('2026-11-03T10:00:00.000Z');

    // O diff novo é contra o salvo mais recente (banda 100 → 5 aparece) e o PUT usa o updatedAt novo.
    await user.click(screen.getByRole('button', { name: p.actions.review }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(`${p.workspace.title} · ${p.workspace.includedBandwidthGb}`)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: p.confirm.save }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: '2026-11-03T10:00:00.000Z' })));
  });

  it('falha na leitura mostra erro com nova tentativa', async () => {
    vi.spyOn(adminCostsService, 'getSettings').mockRejectedValue(new Error('x'));
    renderTab();
    expect(await screen.findByText(S.errors.loadFailed)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: p.actions.retry })).toBeInTheDocument();
  });
});

describe('AdminCostsPage: aba Preços', () => {
  it('a rota /admin/costs/prices abre a aba Preços', async () => {
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view());
    expect(activeCostsTab('/admin/costs/prices')).toBe('/admin/costs/prices');
    renderWithTheme(<MemoryRouter initialEntries={['/admin/costs/prices']}><AdminCostsPage /></MemoryRouter>);
    expect(screen.getByRole('tab', { name: S.tabs.prices })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(p.fx.title)).toBeInTheDocument();
  });
});
