import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { AdminWorkersPage } from '@/pages/admin/AdminWorkersPage';
import { adminWorkersService } from '@/services/adminWorkers.service';
import { readPersisted, writePersisted } from '@/hooks/usePersistedState';
import { workersAdminStrings as t } from '../strings';
import { WORKER_SCALE_DRAFT_KEY, WORKER_SCALE_REFRESH_MS, type WorkerScaleDraft } from '../useWorkerScale';
import type { WorkerScaleEvent, WorkerScaleStateView } from '../types';
import ScaleTab from './ScaleTab';

const sc = t.scale;
const REQUEST_ID = '11111111-2222-4333-8444-555555555555';

const view = (over: Partial<WorkerScaleStateView> = {}): WorkerScaleStateView => ({
  scaler: { status: 'ready', desiredReplicas: 2, runningReplicas: 2, hasDisk: false, autoscalingEnabled: false },
  settings: { scalerMode: 'manual', minReplicas: 1, maxReplicas: 4, scaleCooldownSeconds: 1800 },
  cooldownUntil: null,
  lastEvent: null,
  enforced: true,
  ...over,
});

const event = (id: number, over: Partial<WorkerScaleEvent> = {}): WorkerScaleEvent => ({
  id, at: '2026-11-10T12:00:00.000Z', trigger: 'manual', fromReplicas: 1, toReplicas: 2,
  reason: `motivo ${id}`, outcome: 'succeeded', error: null, ...over,
});

function apiError(status: number, code: string, meta?: Record<string, unknown>) {
  return Object.assign(new Error(code), { status, code, meta });
}

function mockEvents(items: WorkerScaleEvent[] = [], nextCursor: string | null = null) {
  return vi.spyOn(adminWorkersService, 'listScaleEvents').mockResolvedValue({ items, nextCursor });
}

/** `randomUUID` devolvendo um id diferente por chamada. */
function useSequentialIds() {
  let n = 0;
  vi.mocked(crypto.randomUUID).mockImplementation(() => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`);
}

const upButton = () => screen.getByRole('button', { name: sc.actions.up });
const downButton = () => screen.getByRole('button', { name: sc.actions.down });
const reasonField = () => screen.getByRole('textbox', { name: new RegExp(sc.dialog.reasonLabel) });
const confirmButton = () => screen.getByRole('button', { name: sc.dialog.confirm });

async function openUpWithReason(user: ReturnType<typeof userEvent.setup>, reason = 'pico de sessões') {
  await user.click(await screen.findByRole('button', { name: sc.actions.up }));
  const dialog = await screen.findByRole('dialog');
  await user.type(reasonField(), reason);
  return dialog;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(REQUEST_ID);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ScaleTab — estados', () => {
  it('ready: mostra desejadas × rodando, modo e faixa; botões liberados', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view({
      scaler: { status: 'ready', desiredReplicas: 3, runningReplicas: 2, hasDisk: false, autoscalingEnabled: false },
    }));
    mockEvents();
    renderWithTheme(<ScaleTab />, 'dark');
    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(sc.modes.manual)).toBeInTheDocument();
    expect(screen.getByText(sc.tiles.rangeValue(1, 4))).toBeInTheDocument();
    expect(upButton()).toBeEnabled();
    expect(downButton()).toBeEnabled();
    expect(screen.getByText(sc.history.empty)).toBeInTheDocument();
  });

  it('not_configured: lista as envs que faltam e explica a Render e o WORKER_SCALER_ENABLED', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view({
      scaler: { status: 'not_configured', missing: ['WORKER_SCALER_ENABLED', 'RENDER_API_KEY'] },
    }));
    mockEvents();
    renderWithTheme(<ScaleTab />);
    expect(await screen.findByText(sc.notConfigured.title)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: sc.notConfigured.missingLabel });
    expect(within(list).getByText('WORKER_SCALER_ENABLED')).toBeInTheDocument();
    expect(within(list).getByText('RENDER_API_KEY')).toBeInTheDocument();
    expect(within(list).queryByText('WORKER_SCALER_SERVICE_ID')).not.toBeInTheDocument();
    expect(screen.getByText(sc.notConfigured.intro)).toBeInTheDocument();
    expect(screen.getByText(sc.notConfigured.enabledHint)).toBeInTheDocument();
    expect(upButton()).toBeDisabled();
    expect(downButton()).toBeDisabled();
    expect(screen.getAllByText(sc.tiles.noValue)).toHaveLength(2);
  });

  it('unavailable: explica o motivo e desliga os botões', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view({ scaler: { status: 'unavailable', reason: 'auth' } }));
    mockEvents();
    renderWithTheme(<ScaleTab />);
    expect(await screen.findByText(sc.unavailable.reasons.auth)).toBeInTheDocument();
    expect(upButton()).toBeDisabled();
  });

  it('scalerMode off: explica por que os botões estão desligados', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view({
      settings: { scalerMode: 'off', minReplicas: 1, maxReplicas: 4, scaleCooldownSeconds: 1800 },
    }));
    mockEvents();
    renderWithTheme(<ScaleTab />);
    expect(await screen.findByText(sc.blocked.modeOff)).toBeInTheDocument();
    expect(upButton()).toBeDisabled();
    expect(downButton()).toBeDisabled();
  });

  it('enforced: false: explica a adoção desligada', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view({ enforced: false }));
    mockEvents();
    renderWithTheme(<ScaleTab />);
    expect(await screen.findByText(sc.blocked.notEnforced)).toBeInTheDocument();
    expect(upButton()).toBeDisabled();
  });

  it('no máximo da faixa desliga só o Subir', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view({
      scaler: { status: 'ready', desiredReplicas: 4, runningReplicas: 4, hasDisk: false, autoscalingEnabled: false },
    }));
    mockEvents();
    renderWithTheme(<ScaleTab />);
    await screen.findByText(sc.tiles.rangeValue(1, 4));
    expect(upButton()).toBeDisabled();
    expect(downButton()).toBeEnabled();
  });

  it('±1 só liberado se o alvo cair na faixa; Tooltip explica a faixa', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view({
      scaler: { status: 'ready', desiredReplicas: 6, runningReplicas: 6, hasDisk: false, autoscalingEnabled: false },
    }));
    mockEvents();
    renderWithTheme(<ScaleTab />);
    await screen.findByText(sc.tiles.rangeValue(1, 4));
    expect(upButton()).toBeDisabled();
    expect(downButton()).toBeDisabled();
    expect(screen.getByLabelText(sc.actions.stepOutOfRange(7, 1, 4))).toBeInTheDocument();
    expect(screen.getByLabelText(sc.actions.stepOutOfRange(5, 1, 4))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: sc.actions.custom })).toBeEnabled();
  });

  it('abaixo do mínimo: Subir só se o alvo entrar na faixa', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view({
      scaler: { status: 'ready', desiredReplicas: 0, runningReplicas: 0, hasDisk: false, autoscalingEnabled: false },
      settings: { scalerMode: 'manual', minReplicas: 2, maxReplicas: 4, scaleCooldownSeconds: 1800 },
    }));
    mockEvents();
    renderWithTheme(<ScaleTab />);
    await screen.findByText(sc.tiles.rangeValue(2, 4));
    expect(upButton()).toBeDisabled();
    expect(screen.getByLabelText(sc.actions.stepOutOfRange(1, 2, 4))).toBeInTheDocument();
  });

  it('faixa de um só valor: Escolher alvo desligado com explicação própria', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view({
      settings: { scalerMode: 'manual', minReplicas: 2, maxReplicas: 2, scaleCooldownSeconds: 1800 },
    }));
    mockEvents();
    renderWithTheme(<ScaleTab />);
    await screen.findByText(sc.tiles.rangeValue(2, 2));
    expect(screen.getByRole('button', { name: sc.actions.custom })).toBeDisabled();
    expect(screen.getByLabelText(sc.actions.singleValueRange(2))).toBeInTheDocument();
  });

  it('falha na 1ª carga mostra erro com tentar de novo', async () => {
    const get = vi.spyOn(adminWorkersService, 'getScale').mockRejectedValueOnce(new Error('x')).mockResolvedValue(view());
    mockEvents();
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    expect(await screen.findByText(sc.errors.loadFailed)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: sc.retry }));
    expect(await screen.findByRole('button', { name: sc.actions.up })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('ScaleTab — pedido', () => {
  it('subir com sucesso envia alvo, motivo e requestId; limpa o rascunho e recarrega', async () => {
    const get = vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    const list = mockEvents();
    const post = vi.spyOn(adminWorkersService, 'requestScale').mockResolvedValue({
      event: event(9, { fromReplicas: 2, toReplicas: 3, outcome: 'requested' }), replayed: false,
    });
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    await openUpWithReason(user, '  pico de sessões  ');
    expect(readPersisted<WorkerScaleDraft>(WORKER_SCALE_DRAFT_KEY)).toMatchObject({ replicas: 3, requestId: REQUEST_ID });
    await user.click(confirmButton());
    expect(post).toHaveBeenCalledWith({ replicas: 3, reason: 'pico de sessões', requestId: REQUEST_ID });
    expect(await screen.findByText(sc.notices.success(2, 3))).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(readPersisted(WORKER_SCALE_DRAFT_KEY)).toBeUndefined();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('motivo obrigatório: menos de 3 caracteres bloqueia e mostra o erro', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    mockEvents();
    const post = vi.spyOn(adminWorkersService, 'requestScale');
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    await user.click(await screen.findByRole('button', { name: sc.actions.up }));
    await screen.findByRole('dialog');
    expect(confirmButton()).toBeDisabled();
    await user.type(reasonField(), 'ab');
    expect(screen.getByText(sc.dialog.reasonShort)).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    await user.type(reasonField(), 'c');
    expect(confirmButton()).toBeEnabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('alvo fora da faixa ou igual ao atual bloqueia', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    mockEvents();
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    await openUpWithReason(user);
    const target = screen.getByRole('textbox', { name: sc.dialog.targetLabel });
    await user.clear(target);
    await user.type(target, '9');
    expect(screen.getByText(sc.dialog.targetRange(1, 4))).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    await user.clear(target);
    await user.type(target, '2');
    expect(screen.getByText(sc.dialog.targetSame)).toBeInTheDocument();
    await user.clear(target);
    await user.type(target, '1');
    expect(screen.getByText(sc.dialog.downWarning)).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
  });

  it('replay: avisa que nada novo foi pedido', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    mockEvents();
    vi.spyOn(adminWorkersService, 'requestScale').mockResolvedValue({ event: event(9), replayed: true });
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    await openUpWithReason(user);
    await user.click(confirmButton());
    expect(await screen.findByText(sc.notices.replayed)).toBeInTheDocument();
  });

  it('sem resposta (rede) mantém o diálogo e o mesmo requestId na nova tentativa', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    mockEvents();
    const post = vi.spyOn(adminWorkersService, 'requestScale')
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValue({ event: event(9, { fromReplicas: 2, toReplicas: 3 }), replayed: false });
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    await openUpWithReason(user);
    await user.click(confirmButton());
    expect(await screen.findByText(sc.requestErrors.generic)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(confirmButton());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[0][0].requestId).toBe(post.mock.calls[1][0].requestId);
  });

  it('erro com código do servidor: a nova tentativa vai com requestId novo', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    mockEvents();
    useSequentialIds();
    const post = vi.spyOn(adminWorkersService, 'requestScale')
      .mockRejectedValueOnce(apiError(503, 'SCALER_UNAVAILABLE', { reason: 'timeout' }))
      .mockResolvedValue({ event: event(9, { fromReplicas: 2, toReplicas: 3 }), replayed: false });
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    await openUpWithReason(user);
    await user.click(confirmButton());
    expect(await screen.findByText(sc.requestErrors.unavailable)).toBeInTheDocument();
    await user.click(confirmButton());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][0].requestId).not.toBe(post.mock.calls[0][0].requestId);
  });

  it('replay de pedido que falhou: mostra o erro, mantém diálogo e rascunho e troca o requestId', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    const list = mockEvents();
    useSequentialIds();
    const post = vi.spyOn(adminWorkersService, 'requestScale')
      .mockResolvedValueOnce({ event: event(9, { outcome: 'failed', error: 'SCALER_UNAVAILABLE:timeout' }), replayed: true })
      .mockResolvedValue({ event: event(10, { fromReplicas: 2, toReplicas: 3, outcome: 'requested' }), replayed: false });
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    await openUpWithReason(user);
    await user.click(confirmButton());
    expect(await screen.findByText(sc.requestErrors.failedReplay(sc.requestErrors.unavailable))).toBeInTheDocument();
    expect(screen.queryByText(sc.notices.replayed)).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const kept = readPersisted<WorkerScaleDraft>(WORKER_SCALE_DRAFT_KEY);
    expect(kept).toMatchObject({ replicas: 3, reason: 'pico de sessões' });
    expect(kept?.requestId).not.toBe(post.mock.calls[0][0].requestId);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await user.click(confirmButton());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][0].requestId).toBe(kept?.requestId);
    expect(await screen.findByText(sc.notices.success(2, 3))).toBeInTheDocument();
  });

  it('falha sem replay com erro desconhecido usa o texto genérico de falha', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    mockEvents();
    vi.spyOn(adminWorkersService, 'requestScale').mockResolvedValue({
      event: event(9, { outcome: 'failed', error: 'SCALE_REQUEST_FAILED' }), replayed: false,
    });
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    await openUpWithReason(user);
    await user.click(confirmButton());
    expect(await screen.findByText(sc.requestErrors.failedGeneric)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('mudar alvo ou motivo gera requestId novo', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    mockEvents();
    useSequentialIds();
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    await user.click(await screen.findByRole('button', { name: sc.actions.up }));
    await screen.findByRole('dialog');
    const first = readPersisted<WorkerScaleDraft>(WORKER_SCALE_DRAFT_KEY)?.requestId;
    await user.type(reasonField(), 'x');
    const afterReason = readPersisted<WorkerScaleDraft>(WORKER_SCALE_DRAFT_KEY)?.requestId;
    expect(afterReason).not.toBe(first);
    const target = screen.getByRole('textbox', { name: sc.dialog.targetLabel });
    await user.clear(target);
    await user.type(target, '4');
    const afterTarget = readPersisted<WorkerScaleDraft>(WORKER_SCALE_DRAFT_KEY);
    expect(afterTarget).toMatchObject({ replicas: '4', reason: 'x' });
    expect(afterTarget?.requestId).not.toBe(afterReason);
  });

  it('cancelar limpa o rascunho', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    mockEvents();
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    await openUpWithReason(user);
    await user.click(screen.getByRole('button', { name: sc.dialog.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(readPersisted(WORKER_SCALE_DRAFT_KEY)).toBeUndefined();
  });

  it('rascunho restaurado reabre o diálogo com alvo e motivo', async () => {
    const draft: WorkerScaleDraft = { replicas: 3, reason: 'restaurado', requestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };
    writePersisted(WORKER_SCALE_DRAFT_KEY, draft);
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    mockEvents();
    const post = vi.spyOn(adminWorkersService, 'requestScale').mockResolvedValue({ event: event(9), replayed: false });
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    await screen.findByRole('dialog');
    expect(reasonField()).toHaveValue('restaurado');
    expect(screen.getByRole('textbox', { name: sc.dialog.targetLabel })).toHaveValue('3');
    expect(screen.queryByRole('button', { name: sc.dialog.confirm })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: sc.dialog.resend }));
    expect(post).toHaveBeenCalledWith({ replicas: 3, reason: 'restaurado', requestId: draft.requestId });
  });

  it('rascunho restaurado: editar troca o Reenviar por Pedir mudança', async () => {
    writePersisted(WORKER_SCALE_DRAFT_KEY, { replicas: 3, reason: 'restaurado', requestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    mockEvents();
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    await screen.findByRole('button', { name: sc.dialog.resend });
    await user.type(reasonField(), '!');
    expect(confirmButton()).toBeInTheDocument();
    expect(readPersisted<WorkerScaleDraft>(WORKER_SCALE_DRAFT_KEY)?.requestId).toBe(REQUEST_ID);
  });

  it('escalador sem resposta com rascunho: avisa e não reabre sozinho depois; Revisar reabre o mesmo pedido', async () => {
    const draft: WorkerScaleDraft = { replicas: 3, reason: 'restaurado', requestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };
    writePersisted(WORKER_SCALE_DRAFT_KEY, draft);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(adminWorkersService, 'getScale')
      .mockResolvedValueOnce(view({ scaler: { status: 'unavailable', reason: 'timeout' } }))
      .mockResolvedValue(view());
    mockEvents();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithTheme(<ScaleTab />);
    expect(await screen.findByText(sc.pendingDraft.waiting)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: sc.pendingDraft.reopen })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(WORKER_SCALE_REFRESH_MS); });
    expect(await screen.findByText(sc.pendingDraft.text)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: sc.pendingDraft.reopen }));
    await screen.findByRole('dialog');
    expect(reasonField()).toHaveValue('restaurado');
    expect(screen.getByRole('button', { name: sc.dialog.resend })).toBeInTheDocument();
    expect(readPersisted(WORKER_SCALE_DRAFT_KEY)).toEqual(draft);
  });

  it('aviso de rascunho: Descartar limpa o pedido', async () => {
    writePersisted(WORKER_SCALE_DRAFT_KEY, { replicas: 3, reason: 'restaurado', requestId: REQUEST_ID });
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view({ scaler: { status: 'not_configured', missing: ['RENDER_API_KEY'] } }));
    mockEvents();
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    await user.click(await screen.findByRole('button', { name: sc.pendingDraft.discard }));
    expect(screen.queryByText(sc.pendingDraft.waiting)).not.toBeInTheDocument();
    expect(readPersisted(WORKER_SCALE_DRAFT_KEY)).toBeUndefined();
  });
});

describe('ScaleTab — erros do pedido', () => {
  const cases: [string, ReturnType<typeof apiError>, string][] = [
    ['fora da faixa', apiError(400, 'SCALE_TARGET_OUT_OF_RANGE', { field: 'replicas', min: 1, max: 4 }), sc.requestErrors.outOfRange(1, 4)],
    ['modo desligado', apiError(409, 'SCALER_MODE_OFF'), sc.requestErrors.modeOff],
    ['adoção desligada', apiError(409, 'ADOPTION_DISABLED'), sc.requestErrors.adoptionDisabled],
    ['não configurado', apiError(409, 'SCALER_NOT_CONFIGURED', { missing: ['RENDER_API_KEY'] }), sc.requestErrors.notConfigured('RENDER_API_KEY')],
    ['alvo igual', apiError(409, 'SCALE_TARGET_UNCHANGED', { replicas: 2 }), sc.requestErrors.unchanged(2)],
    ['disco', apiError(409, 'SCALER_SERVICE_NOT_SCALABLE', { reason: 'disk' }), sc.requestErrors.notScalable.disk],
    ['limitado', apiError(429, 'SCALER_RATE_LIMITED', { retryAfterSeconds: 30 }), sc.requestErrors.rateLimited(30)],
    ['requestId reusado', apiError(409, 'REQUEST_ID_REUSED'), sc.requestErrors.requestIdReused],
    ['429 com Retry-After', Object.assign(apiError(429, 'RATE_LIMITED'), { retryAfter: '45' }), sc.requestErrors.rateLimited(45)],
    ['429 com retryAt', apiError(429, 'RATE_LIMITED', { retryAt: '2026-11-11T15:30:00.000Z' }),
      sc.requestErrors.rateLimitedAt(new Date('2026-11-11T15:30:00.000Z').toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))],
    ['desconhecido', apiError(500, 'INTERNAL'), sc.requestErrors.generic],
  ];

  it.each(cases)('%s', async (_name, err, message) => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    mockEvents();
    vi.spyOn(adminWorkersService, 'requestScale').mockRejectedValue(err);
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    await openUpWithReason(user);
    await user.click(confirmButton());
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('redução acima da capacidade mostra os números', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    mockEvents();
    vi.spyOn(adminWorkersService, 'requestScale').mockRejectedValue(apiError(409, 'SCALE_DOWN_WOULD_EXCEED_CAPACITY', {
      replicas: 1, maxSessionsPerWorker: 40, ratio: 0.8, connected: 50, capacity: 32,
    }));
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    await user.click(await screen.findByRole('button', { name: sc.actions.down }));
    await screen.findByRole('dialog');
    await user.type(reasonField(), 'economia');
    await user.click(confirmButton());
    expect(await screen.findByText(/Com 1 réplica cabem 32 sessões \(1 × 40 × 0,8\), mas há 50 conectadas\./)).toBeInTheDocument();
  });

  it('intervalo mínimo ativo mostra o horário de liberação', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    mockEvents();
    vi.spyOn(adminWorkersService, 'requestScale').mockRejectedValue(
      apiError(409, 'SCALE_COOLDOWN_ACTIVE', { retryAt: '2026-11-11T15:30:00.000Z' }),
    );
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    await openUpWithReason(user);
    await user.click(confirmButton());
    const when = new Date('2026-11-11T15:30:00.000Z').toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    expect(await screen.findByText(sc.requestErrors.cooldown(when))).toBeInTheDocument();
  });
});

describe('ScaleTab — intervalo mínimo e atualização', () => {
  it('cooldown ativo mostra a barra e desliga os botões', async () => {
    const until = new Date(Date.now() + 25 * 60_000).toISOString();
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view({ cooldownUntil: until }));
    mockEvents();
    renderWithTheme(<ScaleTab />);
    const bar = await screen.findByRole('progressbar', { name: sc.cooldown.aria });
    expect(bar).toHaveAttribute('aria-valuemax', '1800');
    expect(screen.getByText(sc.cooldown.label)).toBeInTheDocument();
    expect(screen.getByText('25 min')).toBeInTheDocument();
    expect(upButton()).toBeDisabled();
  });

  it('cooldown vencido não mostra a barra', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view({ cooldownUntil: new Date(Date.now() - 1000).toISOString() }));
    mockEvents();
    renderWithTheme(<ScaleTab />);
    await screen.findByRole('button', { name: sc.actions.up });
    expect(screen.queryByRole('progressbar', { name: sc.cooldown.aria })).not.toBeInTheDocument();
    expect(upButton()).toBeEnabled();
  });

  it('atualiza o estado a cada 20 s sem acumular intervalos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const get = vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    mockEvents();
    const { unmount } = renderWithTheme(<ScaleTab />);
    await screen.findByRole('button', { name: sc.actions.up });
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(WORKER_SCALE_REFRESH_MS); });
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(WORKER_SCALE_REFRESH_MS); });
    expect(get).toHaveBeenCalledTimes(3);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(WORKER_SCALE_REFRESH_MS * 2); });
    expect(get).toHaveBeenCalledTimes(3);
  });
});

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('ScaleTab — aba visível de novo', () => {
  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).hidden;
  });

  it('relê na hora ao voltar a ficar visível, sem duplicar o intervalo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const get = vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    mockEvents();
    renderWithTheme(<ScaleTab />);
    await screen.findByRole('button', { name: sc.actions.up });
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => { setHidden(true); });
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => { setHidden(false); });
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(WORKER_SCALE_REFRESH_MS); });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('resposta antiga que chega depois não sobrescreve a mais nova', async () => {
    let resolveSlow: (v: WorkerScaleStateView) => void = () => {};
    const ready = (n: number) => view({ scaler: { status: 'ready', desiredReplicas: n, runningReplicas: 1, hasDisk: false, autoscalingEnabled: false } });
    vi.spyOn(adminWorkersService, 'getScale')
      .mockResolvedValueOnce(ready(2))
      .mockImplementationOnce(() => new Promise((r) => { resolveSlow = r; }))
      .mockResolvedValueOnce(ready(3));
    mockEvents();
    renderWithTheme(<ScaleTab />);
    expect(await screen.findByText('2')).toBeInTheDocument();
    await act(async () => { setHidden(false); });
    await act(async () => { setHidden(false); });
    expect(await screen.findByText('3')).toBeInTheDocument();
    await act(async () => { resolveSlow(ready(5)); });
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('5')).not.toBeInTheDocument();
  });
});

describe('ScaleTab — histórico', () => {
  it('lista tipo, de→para, motivo, resultado e pagina pelo cursor', async () => {
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    const list = vi.spyOn(adminWorkersService, 'listScaleEvents')
      .mockResolvedValueOnce({ items: [event(2, { trigger: 'auto' }), event(1, { outcome: 'failed', error: 'timeout' })], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [event(0, { outcome: 'rejected' })], nextCursor: null });
    const user = userEvent.setup();
    renderWithTheme(<ScaleTab />);
    const table = await screen.findByRole('table', { name: sc.history.aria });
    expect(within(table).getByText(sc.history.triggers.auto)).toBeInTheDocument();
    expect(within(table).getAllByLabelText(sc.dialog.change(1, 2))).toHaveLength(2);
    expect(within(table).getByText('motivo 2')).toBeInTheDocument();
    expect(within(table).getByText(sc.history.outcomes.failed)).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith(null);
    await user.click(screen.getByRole('button', { name: sc.history.loadMore }));
    expect(await within(table).findByText('motivo 0')).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith('c1');
    expect(within(table).getByText('motivo 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: sc.history.loadMore })).not.toBeInTheDocument();
  });
});

describe('AdminWorkersPage — aba Escala', () => {
  it('abre a aba pela URL /admin/workers/scale', async () => {
    vi.spyOn(adminWorkersService, 'list').mockResolvedValue({
      workers: [], totals: { workers: 0, sessions: 0, pendingLogins: 0, maxSessions: 0 }, awaiting: 0,
    });
    vi.spyOn(adminWorkersService, 'getScale').mockResolvedValue(view());
    mockEvents();
    renderWithTheme(
      <MemoryRouter initialEntries={['/admin/workers/scale']}>
        <AdminWorkersPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('tab', { name: t.tabs.scale, selected: true })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: sc.actions.up })).toBeInTheDocument();
    expect(screen.getByText(sc.subtitle)).toBeInTheDocument();
  });
});
