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
  it.each(['light', 'dark'] as const)('mostra seções e a cotação automática como Switch ligado com a dica (%s)', async (mode) => {
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view());
    renderTab(mode);
    expect(await screen.findByText(p.fx.title)).toBeInTheDocument();
    for (const title of [p.items.title, p.renderPlans.title, p.aiModels.title, p.workspace.title]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    const sw = screen.getByRole('checkbox', { name: S.pricesReview.autoLabel });
    expect(sw).toBeChecked();
    expect(sw).toHaveAccessibleDescription(S.pricesReview.autoHint);
    expect(screen.queryByText('Em breve')).not.toBeInTheDocument();
    // Sem alteração: nada a revisar.
    expect(screen.getByRole('button', { name: p.actions.review })).toBeDisabled();
  });

  it('desligar a cotação automática entra no diff e salva fx.auto = false', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view());
    const saved: InfraCostSettings = { ...sampleSettings(), fx: { ...sampleSettings().fx, auto: false } };
    const update = vi.spyOn(adminCostsService, 'updateSettings').mockResolvedValue(view({ settings: saved, updatedAt: '2026-11-12T10:00:00.000Z' }));
    renderTab();
    await user.click(await screen.findByRole('checkbox', { name: S.pricesReview.autoLabel }));
    expect(screen.getByRole('checkbox', { name: S.pricesReview.autoLabel })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: p.actions.review }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(`${p.fx.title} · ${S.pricesReview.autoField}`)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: p.confirm.save }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ settings: saved, expectedUpdatedAt: '2026-11-01T10:00:00.000Z' }));
  });

  it('modelo de IA mensal fixo: troca a cobrança, mostra só US$/mês e salva o modo', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view());
    const saved: InfraCostSettings = {
      ...sampleSettings(),
      aiModelPrices: [{ kind: 'OPENAI', model: 'gpt-x', billing: 'monthly', inputPerMTokUsd: null, outputPerMTokUsd: null, monthlyUsd: 19.9 }],
    };
    const update = vi.spyOn(adminCostsService, 'updateSettings').mockResolvedValue(view({ settings: saved }));
    renderTab();
    expect(await screen.findByRole('textbox', { name: p.aiModels.input })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: p.aiModels.billing }));
    await user.click(await screen.findByRole('option', { name: p.aiModels.billingOptions.monthly }));
    expect(screen.queryByRole('textbox', { name: p.aiModels.input })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: p.aiModels.output })).not.toBeInTheDocument();
    const ai = within(document.querySelector('[data-cost-row="aiModelPrices-0"]') as HTMLElement);
    const monthly = ai.getByRole('textbox', { name: p.aiModels.monthlyUsd });
    await user.type(monthly, '19,90');
    await user.click(screen.getByRole('button', { name: p.actions.review }));
    const dialog = await screen.findByRole('dialog');
    const row = within(dialog).getByText(/gpt-x · Cobrança$/).closest('tr') as HTMLElement;
    expect(row.textContent).toContain(p.aiModels.billingOptions.monthly);
    await user.click(within(dialog).getByRole('button', { name: p.confirm.save }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ settings: saved, expectedUpdatedAt: '2026-11-01T10:00:00.000Z' }));
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
    const rate = within(dialog).getByText(`${p.fx.title} · ${p.fx.override} · ${p.fx.rate}`).closest('tr') as HTMLElement;
    expect(rate.textContent).toContain('5,4321');
    expect(within(dialog).getByText(`${p.fx.title} · ${p.fx.override} · ${p.fx.date}`)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: p.confirm.save }));

    await waitFor(() => expect(update).toHaveBeenCalledWith({ settings: saved, expectedUpdatedAt: '2026-11-01T10:00:00.000Z' }));
    expect(await screen.findByText(p.saved)).toBeInTheDocument();
    expect(readPersisted(COST_PRICES_DRAFT_KEY)).toBeUndefined();
  });

  it('remover cotação manual volta ao estado sem cotação manual e entra no diff', async () => {
    const user = userEvent.setup();
    const withOverride: InfraCostSettings = { ...sampleSettings(), fx: { ...sampleSettings().fx, override: { rate: 5.1, date: '2026-11-05' } } };
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view({ settings: withOverride }));
    renderTab();
    await user.click(await screen.findByRole('button', { name: p.fx.removeOverride }));
    expect(screen.getByText(p.fx.overrideEmpty)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: p.actions.review }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(`${p.fx.title} · ${p.fx.override} · ${p.fx.rate}`).closest('tr')?.textContent).toContain('5,1');
  });

  it('rascunho restaurado do sessionStorage aparece no campo, com selo, e pode ser descartado', async () => {
    const user = userEvent.setup();
    const values = sampleSettings();
    values.workspace.planLabel = 'Pro';
    saveDraft({ base: '2026-11-01T10:00:00.000Z', values });
    sessionStorage.setItem(`ui.${COST_PRICES_OPEN_ITEMS_KEY}`, JSON.stringify({ v: 1, d: ['api'] }));
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view());
    renderTab();
    expect(await screen.findByText(p.draftRestored)).toBeInTheDocument();
    expect(box(p.workspace.planLabel)).toHaveValue('Pro');
    // Item aberto também volta (estado da tela por aba).
    expect(box(p.items.fields.label)).toHaveValue('API');
    await user.click(screen.getByRole('button', { name: p.actions.discard }));
    expect(box(p.workspace.planLabel)).toHaveValue('Hobby');
    expect(readPersisted(COST_PRICES_DRAFT_KEY)).toBeUndefined();
    // Descartar também fecha os itens abertos.
    expect(readPersisted(COST_PRICES_OPEN_ITEMS_KEY, { version: 1 })).toBeUndefined();
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

  it('400: marca o campo de meta.field, mostra o rótulo legível e foca o campo', async () => {
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
    expect(screen.getByText(S.errors.rejectedFields(`${p.workspace.title} · ${p.workspace.planLabel}`))).toBeInTheDocument();
    expect(screen.getByText(S.errors.fieldRejected)).toBeInTheDocument();
    expect(box(p.workspace.planLabel)).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(box(p.workspace.planLabel)).toHaveFocus());
    // Editar o campo tira o erro da API.
    await user.type(box(p.workspace.planLabel), 'x');
    expect(screen.queryByText(S.errors.fieldRejected)).not.toBeInTheDocument();
  });

  it('400 em serviço fechado: abre o accordion e foca o campo; alerta com o nome do serviço', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view());
    vi.spyOn(adminCostsService, 'updateSettings').mockRejectedValue(
      Object.assign(new Error('x'), { status: 400, code: 'INVALID_INFRA_COST_SETTINGS', field: 'items[2].monthlyUsd' }),
    );
    renderTab();
    await screen.findByText(p.workspace.title);
    await setText(user, p.workspace.planLabel, 'Pro');
    expect(screen.queryByRole('textbox', { name: p.items.fields.monthlyUsd })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: p.actions.review }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: p.confirm.save }));
    expect(await screen.findByText(S.errors.rejectedFields(`E-mail · ${p.items.fields.monthlyUsd}`))).toBeInTheDocument();
    await waitFor(() => expect(box(p.items.fields.monthlyUsd)).toHaveFocus());
    expect(readPersisted(COST_PRICES_OPEN_ITEMS_KEY, { version: 1 })).toEqual(['email']);
  });

  it('número pt-BR: input mostra vírgula e ponto de milhar é recusado', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view());
    renderTab();
    await screen.findByText(p.workspace.title);
    expect(box(p.workspace.bandwidthUsdPerGb)).toHaveValue('0,15');
    await setText(user, p.workspace.includedBuildMinutes, '1.000');
    expect(screen.getByText(S.pricesReview.thousandsDot)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: p.actions.review })).toBeDisabled();
  });

  it('remover linha leva o foco à seguinte; a última leva ao "Adicionar"', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view());
    renderTab();
    await screen.findByText(p.renderPlans.title);
    await user.click(screen.getByRole('button', { name: p.actions.removeAria('0.5c-512mb') }));
    await waitFor(() => expect(document.activeElement?.closest('[data-cost-row]')?.getAttribute('data-cost-row')).toBe('renderPlanPrices-0'));
    expect(screen.queryByRole('button', { name: p.actions.removeAria('0.5c-512mb') })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: p.actions.removeAria('gpt-x') }));
    await waitFor(() => expect(screen.getByRole('button', { name: p.aiModels.add })).toHaveFocus());
  });

  it('remover serviço aberto foca o resumo do próximo e o aberto segue pela key', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(`ui.${COST_PRICES_OPEN_ITEMS_KEY}`, JSON.stringify({ v: 1, d: ['api', 'email'] }));
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view());
    renderTab();
    await screen.findByText(p.items.title);
    await user.click(screen.getByRole('button', { name: p.actions.removeAria('API') }));
    // O resumo do Worker herdou o índice 0 e recebe o foco; E-mail continua aberto (key, não índice).
    await waitFor(() => expect(document.activeElement?.id).toBe('cost-item-0-summary'));
    expect(box(p.items.fields.label)).toHaveValue('E-mail');
    expect(readPersisted(COST_PRICES_OPEN_ITEMS_KEY, { version: 1 })).toEqual(['email']);
  });

  const conflictError = () => Object.assign(new Error('x'), { status: 409, code: 'INFRA_COST_SETTINGS_CONFLICT' });
  const reviewDialog = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: p.actions.review }));
    return screen.findByRole('dialog');
  };

  it('409: merge de 3 vias mantém o que o outro admin salvou (E-mail 23→30) e aplica o meu por cima', async () => {
    const user = userEvent.setup();
    const newer = sampleSettings();
    newer.items[2].monthlyUsd = 30;
    newer.workspace.includedBandwidthGb = 100;
    const get = vi.spyOn(adminCostsService, 'getSettings')
      .mockResolvedValueOnce(view())
      .mockResolvedValueOnce(view({ settings: newer, updatedAt: '2026-11-03T10:00:00.000Z' }));
    const update = vi.spyOn(adminCostsService, 'updateSettings')
      .mockRejectedValueOnce(conflictError())
      .mockResolvedValueOnce(view({ updatedAt: '2026-11-04T10:00:00.000Z' }));
    renderTab();
    await screen.findByText(p.workspace.title);
    await setText(user, p.workspace.planLabel, 'Pro');
    await user.click(within(await reviewDialog(user)).getByRole('button', { name: p.confirm.save }));

    expect(await screen.findByText(S.pricesReview.conflictMerged)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(box(p.workspace.planLabel)).toHaveValue('Pro');
    expect(box(p.workspace.includedBandwidthGb)).toHaveValue('100');
    expect(readPersisted<CostPricesDraftState>(COST_PRICES_DRAFT_KEY)?.base).toBe('2026-11-03T10:00:00.000Z');

    // O diff novo é contra o salvo mais recente: só o meu campo; nada do outro admin é revertido.
    const dialog = await reviewDialog(user);
    expect(within(dialog).getByText(`${p.workspace.title} · ${p.workspace.planLabel}`)).toBeInTheDocument();
    expect(within(dialog).getAllByRole('row')).toHaveLength(2);
    expect(within(dialog).queryByText(S.pricesReview.conflictChip)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: p.confirm.save }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    const body = update.mock.calls[1][0];
    expect(body.expectedUpdatedAt).toBe('2026-11-03T10:00:00.000Z');
    expect(body.settings.items.find((i) => i.key === 'email')?.monthlyUsd).toBe(30);
    expect(body.settings.workspace).toMatchObject({ planLabel: 'Pro', includedBandwidthGb: 100 });
  });

  it('409 com o mesmo campo mudado dos dois lados: marca conflito e exige revisão antes de salvar', async () => {
    const user = userEvent.setup();
    const newer = sampleSettings();
    newer.items[2].monthlyUsd = 30;
    sessionStorage.setItem(`ui.${COST_PRICES_OPEN_ITEMS_KEY}`, JSON.stringify({ v: 1, d: ['email'] }));
    vi.spyOn(adminCostsService, 'getSettings')
      .mockResolvedValueOnce(view())
      .mockResolvedValueOnce(view({ settings: newer, updatedAt: '2026-11-03T10:00:00.000Z' }));
    const update = vi.spyOn(adminCostsService, 'updateSettings')
      .mockRejectedValueOnce(conflictError())
      .mockResolvedValueOnce(view({ updatedAt: '2026-11-04T10:00:00.000Z' }));
    renderTab();
    await screen.findByText(p.workspace.title);
    await setText(user, p.items.fields.monthlyUsd, '40,5');
    await user.click(within(await reviewDialog(user)).getByRole('button', { name: p.confirm.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Fica o meu valor, com vírgula; a barra avisa o conflito pendente.
    expect(box(p.items.fields.monthlyUsd)).toHaveValue('40,5');
    expect(screen.getByText(S.pricesReview.conflictPending(1))).toBeInTheDocument();
    expect(readPersisted<CostPricesDraftState>(COST_PRICES_DRAFT_KEY)?.conflicts).toEqual(['items[email].monthlyUsd']);

    const dialog = await reviewDialog(user);
    const row = within(dialog).getByText(`E-mail · ${p.items.fields.monthlyUsd}`).closest('tr') as HTMLElement;
    expect(within(row).getByText(S.pricesReview.conflictChip)).toBeInTheDocument();
    // Antes = o que o outro admin salvou, com moeda.
    expect(row.textContent?.replace(/\s/g, ' ')).toContain('US$ 30,00');
    expect(row.textContent?.replace(/\s/g, ' ')).toContain('US$ 40,50');
    const save = within(dialog).getByRole('button', { name: p.confirm.save });
    expect(save).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: S.pricesReview.conflictAck }));
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][0].settings.items.find((i) => i.key === 'email')?.monthlyUsd).toBe(40.5);
    expect(readPersisted(COST_PRICES_DRAFT_KEY)).toBeUndefined();
  });

  it('cotação manual: foco no campo ao informar e no botão ao remover; "Obrigatório" só depois de tocar', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminCostsService, 'getSettings').mockResolvedValue(view());
    renderTab();
    await user.click(await screen.findByRole('button', { name: p.fx.addOverride }));
    const rate = box(p.fx.rate);
    await waitFor(() => expect(rate).toHaveFocus());
    expect(screen.queryByText(S.errors.required)).not.toBeInTheDocument();
    await user.tab();
    expect(await screen.findByText(S.errors.required)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: p.fx.removeOverride }));
    await waitFor(() => expect(screen.getByRole('button', { name: p.fx.addOverride })).toHaveFocus());
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
