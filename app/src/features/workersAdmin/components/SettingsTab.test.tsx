import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { serviceUpdatingStrings } from '@/components';
import { AdminWorkersPage } from '@/pages/admin/AdminWorkersPage';
import { adminWorkersService } from '@/services/adminWorkers.service';
import { readPersisted } from '@/hooks/usePersistedState';
import { workersAdminStrings as t } from '../strings';
import { CAPACITY_TIMEOUT_MS, WORKER_SETTINGS_DRAFT_KEY } from '../useWorkerSettings';
import type { WorkerScaleStateView, WorkerScalingSettings, WorkerScalingSettingsView } from '../types';
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

beforeEach(() => {
  sessionStorage.clear();
  // Padrão: rota de capacidade fora (sem sugestão) — a tela tolera e reforça toda mudança de teto.
  vi.spyOn(adminWorkersService, 'getCapacity').mockRejectedValue(new Error('offline'));
  // Padrão: estado da escala fora — sem afirmar "sem efeito".
  vi.spyOn(adminWorkersService, 'getScale').mockRejectedValue(new Error('offline'));
});

function mockScaler(scaler: WorkerScaleStateView['scaler']) {
  vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue({
    scaler, settings: { scalerMode: 'auto', minReplicas: 1, maxReplicas: 3, scaleCooldownSeconds: 1800 },
    cooldownUntil: null, lastEvent: null, enforced: true,
  });
}

function mockSuggested(suggestedMaxSessions: number | null) {
  vi.spyOn(adminWorkersService, 'getCapacity').mockResolvedValue({
    plans: [],
    cluster: {
      capacity: 80, connected: 30, occupancyPct: 37.5, headroom: 50, requiredReplicas: 1, mbPerSession: 12,
      suggestedMaxSessions, memoryLimitMb: 1024, sampledAt: '2026-11-11T10:00:00.000Z',
    },
    settings: { maxSessionsPerWorker: 40, alertOccupancyRatio: 0.8 },
    enforced: true,
  });
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SettingsTab', () => {
  it('API fora do ar (deploy): estado de atualização e, voltando, carrega a tela', async () => {
    const down = Object.assign(new Error('Network Error'), { serviceUnavailable: true });
    const get = vi.spyOn(adminWorkersService, 'getSettings').mockRejectedValueOnce(down).mockResolvedValue(view());
    mockList();
    const user = userEvent.setup();
    renderWithTheme(<SettingsTab />);
    expect(await screen.findByText(serviceUpdatingStrings.title)).toBeInTheDocument();
    expect(screen.queryByText(s.errors.loadFailed)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: serviceUpdatingStrings.retryNow }));
    expect(await screen.findByRole('textbox', { name: s.fields.maxSessionsPerWorker.label })).toHaveValue('40');
    expect(screen.queryByText(serviceUpdatingStrings.title)).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('erro que não é indisponibilidade continua no alerta com "Tentar de novo"', async () => {
    vi.spyOn(adminWorkersService, 'getSettings').mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    mockList();
    renderWithTheme(<SettingsTab />);
    expect(await screen.findByText(s.errors.loadFailed)).toBeInTheDocument();
    expect(screen.queryByText(serviceUpdatingStrings.title)).not.toBeInTheDocument();
  });

  it('carrega os valores e mostra a faixa "sem efeito" com enforced: false', async () => {
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view({ enforced: false }));
    mockList();
    renderWithTheme(<SettingsTab />, 'dark');
    expect(await screen.findByRole('textbox', { name: s.fields.maxSessionsPerWorker.label })).toHaveValue('40');
    expect(screen.getByText(s.notEnforced)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: s.actions.review })).toBeDisabled();
  });

  it('chip "sem efeito" só com o escalador not_configured', async () => {
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    mockScaler({ status: 'not_configured', missing: ['RENDER_API_KEY'] });
    renderWithTheme(<SettingsTab />);
    expect(await screen.findByText(s.groups.scaling.pending)).toBeInTheDocument();
  });

  it('escalador pronto ou leitura falhando: sem chip "sem efeito" e ajuda sem "ainda sem efeito"', async () => {
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    mockScaler({ status: 'ready', desiredReplicas: 1, runningReplicas: 1, hasDisk: false, autoscalingEnabled: false });
    const { unmount } = renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.maxSessionsPerWorker.label });
    await waitFor(() => expect(adminWorkersService.getScale).toHaveBeenCalled());
    expect(screen.queryByText(s.groups.scaling.pending)).not.toBeInTheDocument();
    unmount();
    vi.mocked(adminWorkersService.getScale).mockRejectedValue(new Error('offline'));
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.maxSessionsPerWorker.label });
    expect(screen.queryByText(s.groups.scaling.pending)).not.toBeInTheDocument();
    for (const f of Object.values(s.fields)) expect(f.help).not.toMatch(/ainda sem efeito/);
    expect(s.replicas.help).not.toMatch(/ainda sem efeito/);
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
    // Reduzir: texto próprio (não derruba sessão); instrução visível fora do placeholder.
    expect(within(dialog).getByText(s.confirm.strongHintLower)).toBeInTheDocument();
    expect(within(dialog).queryByText(s.confirm.strongHintRaise)).not.toBeInTheDocument();
    expect(within(dialog).getByText(s.confirm.strongHelper('20'))).toBeInTheDocument();
    const confirmInput = within(dialog).getByRole('textbox', { name: s.confirm.strongLabel });
    expect(confirmInput).not.toHaveAttribute('placeholder');
    await user.type(confirmInput, '2');
    expect(save).toBeDisabled();
    await user.type(confirmInput, '0');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  it('subir o teto mostra o aviso de memória da confirmação reforçada', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.maxSessionsPerWorker.label });
    await setField(user, 'maxSessionsPerWorker', '50');
    await user.click(screen.getByRole('button', { name: s.actions.review }));
    const dialog = await screen.findByRole('dialog', { name: s.confirm.title });
    expect(within(dialog).getByText(s.confirm.strongHintRaise)).toBeInTheDocument();
    expect(within(dialog).queryByText(s.confirm.strongHintLower)).not.toBeInTheDocument();
  });

  it('razão em pt-BR no campo e no diff; aceita ponto ou vírgula', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    renderWithTheme(<SettingsTab />);
    expect(await screen.findByRole('textbox', { name: s.fields.alertOccupancyRatio.label })).toHaveValue('0,8');
    await setField(user, 'alertOccupancyRatio', '0.9');
    expect(screen.getByRole('button', { name: s.actions.review })).toBeEnabled();
    await setField(user, 'alertOccupancyRatio', '0,85');
    await user.click(screen.getByRole('button', { name: s.actions.review }));
    const dialog = await screen.findByRole('dialog', { name: s.confirm.title });
    expect(within(dialog).getByText('0,8')).toBeInTheDocument();
    expect(within(dialog).getByText('0,85')).toBeInTheDocument();
  });

  it('campo editado mostra "Alterado"; voltar ao valor gravado volta à origem', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.awaitingAlertSeconds.label });
    const awaitingHelp = `${s.fields.awaitingAlertSeconds.range} · `;
    await setField(user, 'awaitingAlertSeconds', '300');
    expect(screen.getByText(awaitingHelp + s.origin.changed)).toBeInTheDocument();
    expect(screen.getByText(`${s.fields.maxSessionsPerWorker.range} · ${s.origin.default}`)).toBeInTheDocument();
    await setField(user, 'awaitingAlertSeconds', '120');
    expect(screen.getByText(awaitingHelp + s.origin.default)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.settings.scalerModes.manual }));
    expect(screen.getByText(s.origin.changed)).toBeInTheDocument();
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

  it('sem batimentos: sem aviso de teto abaixo da ocupação (total do cluster não é por worker)', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList([]);
    mockSuggested(null);
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.maxSessionsPerWorker.label });
    await setField(user, 'maxSessionsPerWorker', '20');
    expect(screen.queryByText(s.belowOccupancy(20, 30))).not.toBeInTheDocument();
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

  it('escalador not_configured: bloco de escala avisa "sem efeito por enquanto"; erro das réplicas ligado ao slider', async () => {
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view({ settings: { ...SETTINGS, minReplicas: 5, maxReplicas: 4 } }));
    mockList();
    mockScaler({ status: 'not_configured', missing: ['WORKER_SCALER_ENABLED'] });
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.maxSessionsPerWorker.label });
    expect(await screen.findByText(s.groups.scaling.pending)).toBeInTheDocument();
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

describe('SettingsTab — teto sugerido pela medição (WSCALE-07)', () => {
  it('teto novo até o sugerido salva sem confirmação reforçada', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    mockSuggested(60);
    const update = vi.spyOn(adminWorkersService, 'updateSettings').mockResolvedValue(view());
    renderWithTheme(<SettingsTab />);
    expect(await screen.findByText(new RegExp(s.suggested(60)))).toBeInTheDocument();
    await setField(user, 'maxSessionsPerWorker', '60');
    await user.click(screen.getByRole('button', { name: s.actions.review }));
    const dialog = await screen.findByRole('dialog', { name: s.confirm.title });
    expect(within(dialog).queryByRole('textbox', { name: s.confirm.strongLabel })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: s.confirm.save }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  it('teto novo acima do sugerido pede o valor digitado com o aviso do sugerido', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    mockSuggested(60);
    renderWithTheme(<SettingsTab />);
    await screen.findByText(new RegExp(s.suggested(60)));
    await setField(user, 'maxSessionsPerWorker', '61');
    await user.click(screen.getByRole('button', { name: s.actions.review }));
    const dialog = await screen.findByRole('dialog', { name: s.confirm.title });
    expect(within(dialog).getByText(s.confirm.strongTitleAbove)).toBeInTheDocument();
    expect(within(dialog).getByText(s.confirm.strongHintAbove('60'))).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: s.confirm.save })).toBeDisabled();
  });

  it('sem amostra (sugestão null) reforça como antes', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    mockSuggested(null);
    const cap = vi.mocked(adminWorkersService.getCapacity);
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.maxSessionsPerWorker.label });
    await waitFor(() => expect(cap).toHaveBeenCalled());
    await setField(user, 'maxSessionsPerWorker', '30');
    await user.click(screen.getByRole('button', { name: s.actions.review }));
    const dialog = await screen.findByRole('dialog', { name: s.confirm.title });
    expect(within(dialog).getByText(s.confirm.strongTitle)).toBeInTheDocument();
    expect(within(dialog).getByText(s.confirm.strongHintLower)).toBeInTheDocument();
  });

  it('reduzir o teto ainda acima do sugerido: título neutro e texto de redução', async () => {
    const user = userEvent.setup();
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList([10]);
    mockSuggested(30);
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.maxSessionsPerWorker.label });
    await setField(user, 'maxSessionsPerWorker', '35');
    expect(await screen.findByText(new RegExp(s.suggested(30)))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: s.actions.review }));
    const dialog = await screen.findByRole('dialog', { name: s.confirm.title });
    expect(within(dialog).getByText(s.confirm.strongTitleLower)).toBeInTheDocument();
    expect(within(dialog).getByText(s.confirm.strongHintLowerAbove('30'))).toBeInTheDocument();
    expect(within(dialog).queryByText(s.confirm.strongTitleAbove)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(s.confirm.strongHintAbove('30'))).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: s.confirm.save })).toBeDisabled();
  });

  it('medição carregando: teto mudado deixa o revisar desabilitado com "Carregando medição…"; após 8 s vira indisponível', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.spyOn(adminWorkersService, 'getSettings').mockResolvedValue(view());
    mockList();
    vi.spyOn(adminWorkersService, 'getCapacity').mockReturnValue(new Promise(() => {}));
    renderWithTheme(<SettingsTab />);
    await screen.findByRole('textbox', { name: s.fields.maxSessionsPerWorker.label });
    // Outro campo não depende da medição.
    await setField(user, 'awaitingAlertSeconds', '300');
    expect(screen.getByRole('button', { name: s.actions.review })).toBeEnabled();
    await setField(user, 'maxSessionsPerWorker', '50');
    expect(screen.getByRole('button', { name: s.actions.loadingSuggestion })).toBeDisabled();
    expect(screen.queryByRole('button', { name: s.actions.review })).not.toBeInTheDocument();
    // Resposta pendurada: o timeout libera o revisar (medição indisponível = confirmação reforçada).
    act(() => { vi.advanceTimersByTime(CAPACITY_TIMEOUT_MS); });
    expect(screen.getByRole('button', { name: s.actions.review })).toBeEnabled();
    expect(screen.queryByRole('button', { name: s.actions.loadingSuggestion })).not.toBeInTheDocument();
    vi.useRealTimers();
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
