import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { AdminWorkersPage } from '@/pages/admin/AdminWorkersPage';
import { adminWorkersService } from '@/services/adminWorkers.service';
import { readPersisted } from '@/hooks/usePersistedState';
import { workersAdminStrings as t } from '../strings';
import { WORKER_SETTINGS_DRAFT_KEY } from '../useWorkerSettings';
import type { WorkerScalingSettings, WorkerScalingSettingsView } from '../types';
import SettingsTab from './SettingsTab';

const s = t.settings;
const SETTINGS: WorkerScalingSettings = {
  maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 10, alertOccupancyRatio: 0.8, awaitingAlertSeconds: 120,
  scalerMode: 'off', minReplicas: 1, maxReplicas: 3, scaleUpSustainSeconds: 600, scaleCooldownSeconds: 1800,
};
const ORIGIN = Object.fromEntries(Object.keys(SETTINGS).map((k) => [k, 'default'])) as WorkerScalingSettingsView['origin'];
const view = (over: Partial<WorkerScalingSettingsView> = {}): WorkerScalingSettingsView => ({
  settings: SETTINGS, origin: ORIGIN, updatedAt: '2026-11-01T10:00:00.000Z', enforced: true, ...over,
});

function mockList(sessions: number[] = [30]) {
  return vi.spyOn(adminWorkersService, 'list').mockResolvedValue({
    workers: sessions.map((n, i) => ({ workerId: `w-${i}`, role: 'worker', sessions: n, pendingLogins: 0, maxSessions: 40, rssMb: 1, seenAt: '' })),
    totals: { workers: sessions.length, sessions: 0, pendingLogins: 0, maxSessions: 0 }, awaiting: 0,
  });
}

const field = (name: keyof typeof s.fields) => screen.getByRole('textbox', { name: s.fields[name].label });

async function setField(user: ReturnType<typeof userEvent.setup>, name: keyof typeof s.fields, value: string) {
  const input = field(name);
  await user.clear(input);
  if (value) await user.type(input, value);
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('SettingsTab', () => {
  it('carrega os valores e mostra a faixa "sem efeito" com enforced: false', async () => {
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view({ enforced: false }));
    mockList();
    renderWithTheme(<SettingsTab />, 'dark');
    expect(await screen.findByRole('textbox', { name: s.fields.maxSessionsPerWorker.label })).toHaveValue('40');
    expect(screen.getByText(s.notEnforced)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: s.actions.review })).toBeDisabled();
  });

  it('enforced: true não mostra a faixa', async () => {
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.maxSessionsPerWorker.label });
    expect(screen.queryByText(s.notEnforced)).not.toBeInTheDocument();
  });

  it('valida o campo fora da faixa e bloqueia o salvar', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.awaitingAlertSeconds.label });
    await setField(user, 'awaitingAlertSeconds', '10');
    expect(screen.getByText(s.errors.range('30', '3.600'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: s.actions.review })).toBeDisabled();
  });

  it('confirma com diff e salva sem confirmação reforçada quando o teto não muda; rascunho limpo', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    const saved = view({ settings: { ...SETTINGS, awaitingAlertSeconds: 300 }, updatedAt: '2026-11-02T10:00:00.000Z' });
    const update = vi.spyOn(adminWorkersService, 'updateSettings').mockResolvedValue(saved);
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.awaitingAlertSeconds.label });
    await setField(user, 'awaitingAlertSeconds', '300');
    expect(readPersisted(WORKER_SETTINGS_DRAFT_KEY)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: s.actions.review }));

    const dialog = await screen.findByRole('dialog', { name: s.confirm.title });
    const row = within(dialog).getByText(s.fields.awaitingAlertSeconds.label).closest('tr')!;
    expect(within(row).getByText('120')).toBeInTheDocument();
    expect(within(row).getByText('300')).toBeInTheDocument();
    expect(within(dialog).queryByText(s.confirm.strongTitle)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: s.confirm.save }));

    await waitFor(() => expect(update).toHaveBeenCalledWith({
      settings: { ...SETTINGS, awaitingAlertSeconds: 300 }, expectedUpdatedAt: '2026-11-01T10:00:00.000Z',
    }));
    expect(await screen.findByText(s.saved)).toBeInTheDocument();
    expect(readPersisted(WORKER_SETTINGS_DRAFT_KEY)).toBeUndefined();
  });

  it('teto muda: confirmação reforçada desabilita o salvar até digitar o valor; avisa ocupação', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList([30, 25]);
    const update = vi.spyOn(adminWorkersService, 'updateSettings').mockResolvedValue(view());
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.maxSessionsPerWorker.label });
    await setField(user, 'maxSessionsPerWorker', '20');
    expect(await screen.findByText(s.belowOccupancy(20, 30))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: s.actions.review }));

    const dialog = await screen.findByRole('dialog', { name: s.confirm.title });
    const save = within(dialog).getByRole('button', { name: s.confirm.save });
    expect(save).toBeDisabled();
    const confirmInput = within(dialog).getByRole('textbox', { name: s.confirm.strongLabel('20') });
    await user.type(confirmInput, '2');
    expect(save).toBeDisabled();
    await user.type(confirmInput, '0');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  it('409: recarrega os valores atuais, descarta o rascunho e avisa', async () => {
    const user = userEvent.setup();
    const get = vi.spyOn(adminWorkersService, 'getSettings')
      .mockResolvedValueOnce(view())
      .mockResolvedValueOnce(view({ settings: { ...SETTINGS, awaitingAlertSeconds: 900 }, updatedAt: '2026-11-03T10:00:00.000Z' }));
    mockList();
    vi.spyOn(adminWorkersService, 'updateSettings').mockRejectedValue(
      Object.assign(new Error('x'), { status: 409, code: 'WORKER_SCALING_SETTINGS_CONFLICT' }),
    );
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.awaitingAlertSeconds.label });
    await setField(user, 'awaitingAlertSeconds', '300');
    await user.click(screen.getByRole('button', { name: s.actions.review }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: s.confirm.save }));

    expect(await screen.findByText(s.errors.conflict)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(field('awaitingAlertSeconds')).toHaveValue('900');
    expect(readPersisted(WORKER_SETTINGS_DRAFT_KEY)).toBeUndefined();
  });

  it('400 com meta.field marca o campo recusado', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    vi.spyOn(adminWorkersService, 'updateSettings').mockRejectedValue(
      Object.assign(new Error('x'), { status: 400, code: 'INVALID_WORKER_SCALING_SETTINGS', field: 'awaitingAlertSeconds' }),
    );
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.awaitingAlertSeconds.label });
    await setField(user, 'awaitingAlertSeconds', '300');
    await user.click(screen.getByRole('button', { name: s.actions.review }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: s.confirm.save }));
    expect(await screen.findByText(s.fieldRejected)).toBeInTheDocument();
    expect(screen.getByText(s.errors.invalid)).toBeInTheDocument();
  });

  it('sem adoção não mostra o aviso de teto abaixo da ocupação', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view({ enforced: false }));
    mockList([30]);
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.maxSessionsPerWorker.label });
    await setField(user, 'maxSessionsPerWorker', '20');
    expect(screen.queryByText(s.belowOccupancy(20, 30))).not.toBeInTheDocument();
    expect(screen.getByText(s.notEnforced)).toBeInTheDocument();
  });

  it('bloco de escala avisa "sem efeito por enquanto"; erro das réplicas ligado ao slider', async () => {
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view({ settings: { ...SETTINGS, minReplicas: 5, maxReplicas: 4 } }));
    mockList();
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.maxSessionsPerWorker.label });
    expect(screen.getByText(s.groups.scaling.pending)).toBeInTheDocument();
    const help = screen.getByText(s.errors.maxBelowMin);
    expect(help.id).toBeTruthy();
    for (const thumb of screen.getAllByRole('slider')) expect(thumb).toHaveAttribute('aria-describedby', help.id);
  });

  it('400 em scalerMode aparece abaixo do seletor de modo', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    vi.spyOn(adminWorkersService, 'updateSettings').mockRejectedValue(
      Object.assign(new Error('x'), { status: 400, code: 'INVALID_WORKER_SCALING_SETTINGS', field: 'scalerMode' }),
    );
    renderWithTheme(<SettingsTab />);
    await user.click(await screen.findByRole('button', { name: s.scalerModes.manual }));
    await user.click(screen.getByRole('button', { name: s.actions.review }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: s.confirm.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const help = await screen.findByText(s.fieldRejected);
    expect(help).toHaveClass('Mui-error');
    expect(screen.getByRole('button', { name: s.scalerModes.manual }).parentElement).toHaveAttribute('aria-describedby', help.id);
  });

  it('rascunho com base null (antes de existir linha) mantém expectedUpdatedAt null e o PUT dá 409', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(`ui.${WORKER_SETTINGS_DRAFT_KEY}`, JSON.stringify({
      v: 0, d: { base: null, values: { ...SETTINGS, awaitingAlertSeconds: '450' } },
    }));
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    const update = vi.spyOn(adminWorkersService, 'updateSettings').mockRejectedValue(
      Object.assign(new Error('x'), { status: 409, code: 'WORKER_SCALING_SETTINGS_CONFLICT' }),
    );
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.awaitingAlertSeconds.label });
    await setField(user, 'awaitingAlertSeconds', '500');
    await user.click(screen.getByRole('button', { name: s.actions.review }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: s.confirm.save }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({
      settings: { ...SETTINGS, awaitingAlertSeconds: 500 }, expectedUpdatedAt: null,
    }));
    expect(await screen.findByText(s.errors.conflict)).toBeInTheDocument();
  });

  it('rascunho salvo na aba é restaurado ao abrir', async () => {
    sessionStorage.setItem(`ui.${WORKER_SETTINGS_DRAFT_KEY}`, JSON.stringify({
      v: 0, d: { base: '2026-11-01T10:00:00.000Z', values: { ...SETTINGS, awaitingAlertSeconds: '450' } },
    }));
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    renderWithTheme(<SettingsTab />);
    expect(await screen.findByRole('textbox', { name: s.fields.awaitingAlertSeconds.label })).toHaveValue('450');
    expect(screen.getByText(s.draftRestored)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: s.actions.review })).toBeEnabled();
  });
});

describe('AdminWorkersPage — abas', () => {
  it('rota /admin/workers/settings ativa a aba Configuração (chunk lazy)', async () => {
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    renderWithTheme(<MemoryRouter initialEntries={['/admin/workers/settings']}><AdminWorkersPage /></MemoryRouter>);
    expect(screen.getByRole('tab', { name: t.tabs.settings })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('textbox', { name: s.fields.maxSessionsPerWorker.label })).toBeInTheDocument();
    expect(screen.getByText(s.subtitle)).toBeInTheDocument();
  });
});
